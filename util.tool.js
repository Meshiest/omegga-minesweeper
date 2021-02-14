/*
  cake's save parsing and writing tool
*/

const brs = require('brs-js');

// Helper for shallow equality
const eq = (a, b) => a === b || a.every && a.every((v, i) => v === b[i]);

// Helper function to build dictionaries from arrays, I could technically just use indexOf but w/e
const indexify = (arr, key) =>
  Object.fromEntries(Object.entries(arr || []).map(a =>
    [key ? a[1][key] : a[1], Number(a[0])]));
const deIndexify = map => {
  const arr = Array.from({length: Object.keys(map).length});
  for (const key in map) {
    arr[map[key]] = key;
  }
  return arr;
};

// helper for inefficiently deep cloning an object
const clone = obj => JSON.parse(JSON.stringify(obj));

// convert x, y, z into stud, stud, plate
const studs = (x, y, z) => [x * 10, y * 10, z * 4 + 2];

// determine the center of mass for a group of bricks
const centerOfMass = bricks => bricks
  .reduce((a, b) => a.map((x, i) => x + b[i]), [0, 0, 0])
  .map(p => Math.round(p / bricks.length));

// move a cluster of bricks
const moveBricks = (bricks, shift) => bricks.map(b => {
  const copy = clone(b);
  copy.position.forEach((p, i) => copy.position[i] = p + shift[i]);
  return copy;
});


class ParseTool {
  constructor(save) {
    // Lookup tables to parse from string to value
    this.materials = indexify(save.materials);
    this.assets = indexify(save.brick_assets);
    this.names = indexify(save.brick_owners, 'name'); // both of these are off by 1 due to 1-indexing
    this.ids = indexify(save.brick_owners, 'id'); // both of these are off by 1 due to 1-indexing

    this.save = save;
  }

  findAsset(name) { return this.assets[name]; }
  findMaterial(name) {return this.materials[name]; }

  // query the save or a group of bricks for a subset
  query({asset='', size, rotation=-1, material='', id='', color, name=''}, bricks) {
    return (bricks || this.save.bricks).filter(b =>
      (!size || eq(b.size, size)) &&
      (typeof color === 'undefined' || eq(b.color, color)) &&
      (!asset || b.asset_name_index === this.assets[asset]) &&
      (!material || b.material_index === this.materials[material]) &&
      (!id || b.owner_index === this.ids[id] + 1) &&
      (!name || b.owner_index === this.names[name] + 1) &&
      (rotation === -1 || b.rotation === rotation)
    );
  }

  // detect all bricks above a brick
  aboveBrick(b) {
    const size = b.rotation === 1 || b.rotation == 3 ? [b.size[1], b.size[0], b.size[2]] : b.size;

    const min = [b.position[0] - size[0] - 2, b.position[1] - size[1] - 2, b.position[2] + 1];
    const max = [b.position[0] + size[0] + 2, b.position[1] + size[1] + 2, Infinity];
    return this.save.bricks.filter(b => b.position.every((p, i) => p > min[i] && p < max[i]));
  }

  // detect all bricks between two bricks
  betweenBricks(query, bricks) {
    const markers = this.query(query);

    // this query must return two bricks
    if (markers.length !== 2) {
      return null;
    }

    const min = [Math.min(markers.map(b => b.position[0])), Math.min(markers.map(b => b.position[1])), 0];
    const max = [Math.max(markers.map(b => b.position[0])), Math.max(markers.map(b => b.position[1])), Infinity];

    return (bricks || this.save.bricks).filter(b => b.position.every((p, i) => p > min[i] && p < max[i]));
  }

  // detect all plates above this plate
  abovePlate(b) {
    const size = b.rotation === 1 || b.rotation == 3 ? [b.size[1], b.size[0], b.size[2]] : b.size;

    const min = [b.position[0] - size[0], b.position[1] - size[1], b.position[2] + 4];
    const max = [b.position[0] + size[0], b.position[1] + size[1], b.position[2] + 4];
    return this.save.bricks.filter(b => b.position.every((p, i) => p > min[i] && p < max[i]));
  }
}

class WriteTool {
  constructor(save) {
    this.bricks = save.bricks || [];

    // Lookup tables to parse from string to value
    this.materials = save && save.materials ? indexify(save.materials) : {};
    this.assets = save && save.brick_assets ? indexify(save.brick_assets) : {};
    this.names = save && save.brick_owners ? indexify(save.brick_owners, 'name') : {}; // both of these are off by 1 due to 1-indexing
    this.ids = save && save.brick_owners ? indexify(save.brick_owners, 'id') : {}; // both of these are off by 1 due to 1-indexing
    this.bricks = save && save.bricks || [];

    this.save = save;

    this.author = {
      id: '039b96e9-1646-4b7d-9434-4c726218c6fa',
      name: 'Generator',
    };
    this.colors = save && save.colors || [];
  }

  empty() {
    this.bricks = [];
    return this;
  }

  // find or insert an asset
  findAsset(name) {
    if (typeof this.assets[name] !== 'undefined')
      return this.assets[name];
    return this.assets[name] = Object.keys(this.assets).length;
  }

  // find or insert a material
  findMaterial(name) {
    if (typeof this.materials[name] !== 'undefined')
      return this.materials[name];
    return this.materials[name] = Object.keys(this.materials).length;
  }

  // create a brick
  brick({
    asset='PB_DefaultBrick',
    material='BMC_Plastic',
    position,
    rotation=0,
    direction=4,
    color=[255, 255, 255, 255],
    size=[10, 10, 10],
    visibility=true,
    collision=true,
  }) {
    return {
      asset_name_index: this.findAsset(asset),
      color,
      material_index: typeof material === 'number' ? material : this.findMaterial(material),
      size,
      rotation,
      direction,
      position,
      visibility,
      collision,
    };
  }

  setAuthor(author) {
    this.author = author;
    return this;
  }

  setColors(colors) {
    this.colors = colors;
    return this;
  }

  add(...args) {
    this.bricks.push(...args.map(b => this.brick(b)));
    return this;
  }

  addBrick(...args) {
    this.bricks.push(...args);
    return this;
  }

  write() {
    const author = this.author;

    const authors = this.authors || [];

    // overwrite ownership
    if (authors.length === 0)
      for(const b of this.bricks)
        b.owner_index = 1;

    const output = {
      author,
      description: 'Generated Save',
      map: 'brs-js',
      brick_owners: [author, ...authors],
      materials: deIndexify(this.materials),
      brick_assets: deIndexify(this.assets),
      colors: this.colors,
      bricks: this.bricks,
    };

    return output;
  }
}

module.exports = {
  ParseTool,
  WriteTool,
  studs,
  centerOfMass,
  moveBricks,
};
