const brs = require('brs-js');
const fs = require('fs');
const {chat: { sanitize }} = OMEGGA_UTIL;

const { ParseTool, WriteTool, moveBricks, studs } = require('./util.tool.js');
const CooldownProvider = require('./util.cooldown.js');

// determine which tileset to use
let MINESIZE = 8; // 4 is also an option for uglier and smaller grid
const MINESAVE = __dirname + '/tileset.brs';
const MINESAVE_A5 = __dirname + '/tileset_a5.brs';

// queries for tileset
const TILESET_QUERIES = () => ({
  tile: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Metallic', color: 1}),
  mine: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Metallic', color: 2}),
  x: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Metallic', color: 3}),
  smile: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Glow', color: 1}),
  frown: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Glow', color: 2}),
  sunglasses: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Glow', color: 3}),
  0: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Glow', color: 0}),
  1: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Hologram', color: 0}),
  2: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Hologram', color: 1}),
  3: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Hologram', color: 2}),
  4: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Hologram', color: 3}),
  5: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Hologram', color: 4}),
  6: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Hologram', color: 5}),
  7: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Hologram', color: 6}),
  8: ({asset: 'PB_DefaultBrick', size: [MINESIZE*5, MINESIZE*5, 2], material: 'BMC_Hologram', color: 7}),
});

// parse tiles helper func
const parseTiles = tool => Object.fromEntries(Object.entries(TILESET_QUERIES()).map(([i, q]) => {
  const plate = tool.query(q)[0];
  return plate ? [i, moveBricks(tool.aboveBrick(plate), plate.position.map(v => -v))] : [i, null];
}));

// generate a save from a list of tiles ({tile: 'tile name', pos: [x, y, z]})
const getTileSaveProvider = parser => {
  // parse the tileset
  const tiles = parseTiles(parser);

  // return a function to generate saves from the tiles
  return (grid=[], author=null) => {
    const tool = new WriteTool(parser.save).empty();

    // add an author if provided
    if (author)
      tool.authors = [author];

    // add all the tiles to the save
    for (const {tile, pos: [x, y, z], owned} of grid) {
      const bricks = moveBricks(tiles[tile], studs(x * MINESIZE, y * MINESIZE, (MINESIZE === 2 ? z/2 - 0.5: z)));

      if (owned)
        bricks.forEach(b => b.owner_index = 2);

      tool.addBrick(...bricks);
    }
    return tool.write();
  };
};

class Minesweeper {
  constructor(omegga, config, _store) {
    this.omegga = omegga;
    this.config = config;
    this.setup = false;
    MINESIZE = config['microbricks'] ? 2 : 8;
  }

  // only parse the tileset on the first request
  getTileSave(...args) {
    if (!this.setup) {
      const tileset = new ParseTool(brs.read(fs.readFileSync(Omegga.version === 'a4' ? MINESAVE : MINESAVE_A5)));

      this.getTileSave = getTileSaveProvider(tileset);
      this.setup = true;
    }

    return this.getTileSave(...args);
  }

  // determine if a player is authorized
  isAuthorized(name) {
    const player = Omegga.getPlayer(name);
    return !this.config['only-authorized'] || player.isHost() || this.config['authorized-users'].some(p => player.id === p.id);
  }

  init() {
    // global persistence for minesweeper games
    global.minesweepers = global.minesweepers || [];
    global.minesweeperTrust = global.minesweeperTrust || {};

    this.isA4 = () => this.omegga.version === 'a4';

    this.cooldown = CooldownProvider(1000);
    this.startCooldown = CooldownProvider(5000);

    const commands = {
      start: (name, ...args) => this.isAuthorized(name) && this.startCooldown(name) && this.startGame(name, ...args),
      mine: name => this.isAuthorized(name) && this.cooldown(name) && this.mineTile(name),
      stats: name => this.isAuthorized(name) && this.cooldown(name) && this.getStats(name),
      clearall: name => {
        const player = this.omegga.getPlayer(name);
        if (player.isHost() || this.config['authorized-users'].some(p => player.id === p.id))
          this.clearBricks();
      },
      trust: (name, ...args) => this.isAuthorized(name) && this.cooldown(name) && this.trustPlayer(name, ...args),
    };

    this.omegga
      .on('chatcmd:ms:start', commands.start)
      .on('chatcmd:ms:mine', commands.mine)
      .on('chatcmd:ms:stats', commands.stats)
      .on('chatcmd:ms:clearall', commands.clearall)
      .on('chatcmd:ms:trust', commands.trust)
      .on('chatcmd:ms', (name, command, ...args) => {
        if (commands[command]) {
          commands[command](name, ...args);
        }
      })
      .on('cmd:ms:start', commands.start)
      .on('cmd:ms:mine', commands.mine)
      .on('cmd:ms:stats', commands.stats)
      .on('cmd:ms:clearall', commands.clearall)
      .on('cmd:ms:trust', commands.trust)
      .on('cmd:ms', (name, command, ...args) => {
        if (commands[command]) {
          commands[command](name, ...args);
        }
      });

    return {
      registeredCommands: [
        'ms:start',
        'ms:mine',
        'ms:stats',
        'ms:clearall',
        'ms:trust',
        'ms',
      ],
    };
  }

  stop() {
    this.omegga
      .removeAllListeners('chatcmd:ms:start')
      .removeAllListeners('chatcmd:ms:mine')
      .removeAllListeners('chatcmd:ms:stats')
      .removeAllListeners('chatcmd:ms:clearall')
      .removeAllListeners('chatcmd:ms:trust')
      .removeAllListeners('chatcmd:ms')
      .removeAllListeners('cmd:ms:start')
      .removeAllListeners('cmd:ms:mine')
      .removeAllListeners('cmd:ms:stats')
      .removeAllListeners('cmd:ms:clearall')
      .removeAllListeners('cmd:ms:trust')
      .removeAllListeners('cmd:ms');
  }

  // send messages to everyone or to one person
  toAll(...messages) { this.omegga.broadcast(...messages); }
  toOne(name, ...messages) {
    // TODO: maybe make this broadcast if in A4
    if (this.isA4())
      this.toAll(...messages);
    else
      this.omegga.whisper(name, ...messages);
  }

  // start a game for this player
  async startGame(name, ...args) {
    if (global.minesweepers.find(m => m.name === name && m.inProgress)) {
      return this.toOne(name, `"<b>${sanitize(name)}</> already has a game in progress"`);
    }

    // default game setup
    let width = 10;
    let height = 10;
    let mines = 0;

    // parse key:val from args
    for (const arg of args) {
      if (arg.split(':').length !== 2) continue;
      let [key, val] = arg.split(':');

      val = parseInt(val);
      if (val != Math.floor(val))
        continue;

      switch(key) {
      case 'width':
        width = Math.max(Math.min(50, val), 5);
        break;
      case 'height':
        height = Math.max(Math.min(50, val), 5);
        break;
      case 'size':
        width = Math.max(Math.min(50, val), 5);
        height = Math.max(Math.min(50, val), 5);
        break;
      case 'mines':
        mines = Math.max(val, 1);
        break;
      }
    }

    // default game is 15% mines, yields ~ 50% win ratio
    if (mines === 0) mines = Math.round(width * height * 0.15);

    // player would have too many mines (first guess is safe, 4 corners are safe)
    if(mines > width * height - 5) {
      return this.toOne(name, `"<b>${sanitize(name)}</>'s game would have too many mines"`);
    }

    // get the player's position or message user the error
    let x, y;
    try {
      [x, y] = await this.omegga.getPlayer(name).getPosition();
    } catch (e) {
      this.toOne(name, `"Could not find <b>${sanitize(name)}</>"`);
      return;
    }

    // align to grid
    x = Math.round(x/MINESIZE/10);
    y = Math.round(y/MINESIZE/10);

    // game bounding box
    const left = x;
    const top = y;
    const bottom = (y + height);
    const right = (x + width);

    // find other games that might overlap or border this game
    if (global.minesweepers.find(m =>
      !(left > m.right ||
       right < m.left ||
       top > m.bottom ||
       bottom < m.top)
    )) {
      this.toOne(name, `"<b>${sanitize(name)}</> can't start a game here (overlap)"`);
      return;
    }

    this.toAll(`"<b>${sanitize(name)}</> starting at (${left},${top}) (${width}x${height} ${mines} mines = ${Math.round(mines/(width*height)*100)}%)"`);

    // create game object
    const game = {
      width,
      height,
      mines,
      name,
      inProgress: true,
      x, y,
      left, top, bottom, right,
      stats: {},
    };

    // progress helper function for determining far complete the game is
    game.progress = () => {
      // memoize progress if the game is over
      if (!game.inProgress && typeof game.memoProgress !== 'undefined')
        return game.memoProgress;

      // count revealed cells
      let revealed = 0;
      for (let i = 0; i < game.width; i++)
        for (let j = 0; j < game.height; j++)
          if (game.generated[i][j])
            revealed ++;

      // compare to total number of possible cells
      return game.memoProgress = Math.min(revealed / (game.width * game.height - game.mines), 1);
    };

    // create an empty 2d array
    game.generated = Array.from({length: width})
      .map(() => Array.from({length: height}).fill(0));

    // fill the preset grid with tiles and a smile
    const grid = [];
    grid.push({tile: 'smile', pos: [-1 + left, -1 + top, -1]});
    for (let i = 0; i < game.width; i++)
      for (let j = 0; j < game.height; j++)
        grid.push({tile: 'tile', pos: [i + left, j + top, -1]});

    try {
      // load the board in
      this.omegga.writeSaveData('mine_' + name, this.getTileSave(grid));
      this.omegga.loadBricks('mine_' + name, {quiet: !this.isA4()});

      // add the game the list of minesweepers
      global.minesweepers.push(game);
    } catch (e) {
      console.error('error starting minesweeper game for', name, e);
    }
  }

  // mine the tile under this player and potentially end game
  async mineTile(name) {
    let x, y;
    try {
      [x, y] = await this.omegga.getPlayer(name).getPosition();
    } catch (e) {
      this.toOne(name, `"Could not find <b>${sanitize(name)}</>"`);
      return;
    }

    // round to grid
    x = Math.round(x/MINESIZE/10);
    y = Math.round(y/MINESIZE/10);

    // mine at a position
    const game = Minesweeper.findGame(x, y);

    // check if the game exists
    if (!game) {
      this.toOne(name, `"<b>${sanitize(name)}</> is not over an active game"`);
      return;
    }

    // check if the game owner trusts the player
    if (!Minesweeper.hasTrust(game.name, name)) {
      this.toOne(name, `"<b>${sanitize(game.name)}</> does not trust you to do that, <b>${sanitize(name)}</>"`);
      return;
    }

    // get the relative position of player over the board
    const cx = x - game.x;
    const cy = y - game.y;

    let grid = [];

    // generate a board starting at the given position (first move can't be a mine)
    if (!game.board)
      game.board = Minesweeper.genMinesweeperBoard(game.width, game.height, game.mines, [[cx, cy]]);

    // end game if there's a mine
    if(game.board.isMine(cx, cy)) {
      // render an X at this mine
      grid.push({tile: 'x', pos: [cx, cy, 1]});

      // render the game mines
      for(let i = 0; i < game.width; i++)
        for(let j = 0; j < game.width; j++)
          if (game.board.isMine(i, j))
            grid.push({tile: 'mine', pos: [i, j, 0]});

      // end the game, add a frown
      game.inProgress = false;
      grid.push({tile: 'frown', pos: [-1, -1, 0]});
      game.lastMove = name;
      this.toAll(`"<color=\\"ff9999\\"><b>${sanitize(name)}</> lost a game at <b>${Math.round(game.progress()*100)}% complete</>${
        name !== game.name ? ` on <b>${sanitize(game.name)}</>'s behalf` : ' '
      }...</> (${game.width}x${game.height} ${game.mines} mines = ${Math.round(game.mines/(game.width*game.height)*100)}%)"`);
    } else {
      // get the count of the current tile
      const count = game.board.count(cx, cy);

      // add stats to this player
      game.stats[name] = (game.stats[name] || 0) + 1;

      // render the count if there's more than 0
      if (count > 0) {
        grid.push({tile: 0, pos: [cx, cy, 0]});
        grid.push({tile: count, pos: [cx, cy, 1]});
      } else {
        // otherwise recursively reveal the cells that are adjacent to connecting 0's
        let revealed = {};

        // check if a cell has been or will be revealed
        const hidden = (x, y) => !revealed[x + '_' + y] && !game.generated[x][y];

        function reveal(x, y) {
          // reveal this cell
          revealed[x + '_' + y] = true;

          // render the count
          const count = game.board.count(x, y);
          grid.push({tile: 0, pos: [x, y, 0]});

          // don't recurse if this is nonzero
          if (count !== 0) {
            grid.push({tile: count, pos: [x, y, 1]});
            return;
          }

          // reveal in all 8 directions if not already revealed
          if (y > 0 && hidden(x, y - 1)) reveal(x, y - 1);
          if (y < (game.height - 1) && hidden(x, y + 1)) reveal(x, +y + 1);
          if (x < (game.width - 1) && hidden(x + 1, y)) reveal(+x + 1, y);
          if (x > 0 && hidden(x - 1, y)) reveal(x - 1, y);
          if (y > 0 && x > 0 && hidden(x - 1, y - 1)) reveal(x - 1, y - 1);
          if (y > 0 && x < (game.width - 1) && hidden(x + 1, y - 1)) reveal(x + 1, y - 1);
          if (y < (game.height - 1) && x < (game.width - 1) && hidden(x + 1, y + 1)) reveal(x + 1, y + 1);
          if (y < (game.height - 1) && x > 0 && hidden(x - 1, y + 1)) reveal(x - 1, +y + 1);
        }
        reveal(cx, cy);
      }
    }

    // remove ones that were already generated
    grid = grid.filter(({pos: [x, y, _z]}) => x < 0 || y < 0 || !game.generated[x][y]);
    if (game.inProgress)
      grid.forEach(({pos: [x, y, _z]}) => {
        if(x >= 0 && y >= 0) game.generated[x][y] = 1;
      });

    // only win if the game is in progress and all the non-bomb cells have been reveal
    let win = false;
    if (game.inProgress && game.progress() === 1) {
      game.inProgress = false;
      win = true;
      // render sunglasses
      grid.push({tile: 'sunglasses', pos: [-1, -1, 0]});
    }

    // write to save and load bricks
    try {
      this.omegga.writeSaveData('mine_' + name, this.getTileSave(grid
        .map(({tile, pos: [x, y, z]}) => ({tile, pos: [x + game.left, y + game.top, z]}))
      ));
      this.omegga.loadBricks('mine_' + name, {quiet: !this.isA4()});
    } catch (e) {
      console.error('error loading revealed minesweeper tiles for', name, e);
    }

    // announce win
    if (win) {
      game.lastMove = name;
      this.toAll(`"<color=\\"99ff99\\"><b>${sanitize(name)}</> finished a game${
        name !== game.name ? ` on <b>${sanitize(game.name)}</>'s behalf` : ''
      }!</> (${game.width}x${game.height} ${game.mines} mines = ${Math.round(game.mines/(game.width*game.height)*100)}%)"`)
    }
  }

  // get stats for the game under this player
  async getStats(name) {
    let x, y;
    try {
      [x, y] = await this.omegga.getPlayer(name).getPosition();
    } catch (e) {
      this.toOne(name, `"Could not find <b>${sanitize(name)}</>"`);
      return;
    }

    // round to grid
    x = Math.round(x/MINESIZE/10);
    y = Math.round(y/MINESIZE/10);

    const game = Minesweeper.findGame(x, y, true);

    // make sure the game exists
    if (!game) {
      this.toOne(name, `"<b>${sanitize(name)}</> is not over a game"`)
      return;
    }

    // tell the player all the stats
    this.toOne(name, `"[${
      game.inProgress
        ? `<color=\\"cccccc\\">${Math.round(game.progress()*100)}%</>`
        : game.progress() !== 1 ? `<color=\\"ff9999\\">lost @ ${Math.round(game.progress()*100)}%</>` : '<color=\\"99ff99\\">won</>'
    }] <b>${sanitize(game.name)}</> (${game.width}x${game.height} ${game.mines} mines = ${Math.round(game.mines/(game.width*game.height)*100)}%)"`);
    if (game.stats && Object.keys(game.stats).length) {
      for (const key in game.stats) {
        this.toOne(name, `" -- <b>${sanitize(key)}</>: ${game.stats[key]} moves ${game.lastMove && game.lastMove === key ? '(final move)' : ''}"`);
      }
      if (game.lastMove && !game.stats[game.lastMove])
        this.toOne(name, `"<b>${sanitize(game.lastMove)}</>'s only move was losing the game"`);
    }
  }

  // clear boards
  clearBricks() {
    global.minesweepers = [];
    if (this.isA4())
      this.omegga.clearAllBricks();
    else
      this.omegga.clearBricks('039b96e9-1646-4b7d-9434-4c726218c6fa');
    // A4
  }

  // trust a player
  trustPlayer(name, ...args) {
    const target = args.join(' ');

    // find the target, give notice if player doesn't exist
    const player = this.omegga.findPlayerByName(target);
    if (!player) {
      return this.toOne(name, `"Could not find <b>${sanitize(target)}</>"`);
    }

    // can't trust yourself
    if (player.name === name) {
      return;
    }


    if (!global.minesweeperTrust[name])
      global.minesweeperTrust[name] = [];

    if (global.minesweeperTrust[name].includes(player.name)) {
      global.minesweeperTrust[name].splice(global.minesweeperTrust[name].indexOf(player.name), 1);
      this.toOne(name, `"<b>${sanitize(name)}</> no longer trusts <b>${sanitize(player.name)}</> for minesweeper"`);
      this.toOne(player, `"<b>${sanitize(name)}</> no longer trusts <b>${sanitize(player.name)}</> for minesweeper"`);
    } else {
      global.minesweeperTrust[name].push(player.name);
      this.toOne(name, `"<b>${sanitize(name)}</> now trusts <b>${sanitize(player.name)}</> for minesweeper"`);
      if (!this.isA4())
        this.toOne(player, `"<b>${sanitize(name)}</> now trusts <b>${sanitize(player.name)}</> for minesweeper"`);
    }
  }

  // populate a minesweeper board with mines, provide some helper funcs
  static genMinesweeperBoard(width, height, mines, banned=[]) {
    // build the board widthxheight
    const board = Array.from({length: width})
      .map(() => Array.from({length: height}).fill(0));

    // rand helper fn
    const rand = n => Math.floor(Math.random() * n);

    // out of bounds
    const oob = (x, y) => (x === 0 && y === 0 || x === 0 && y === height-1 || x === width-1 && y === 0 || x === width-1 && y === height-1);

    // place a mine on the board
    const placeMine = () => {
      let x, y;
      do {
        x = rand(width);
        y = rand(height);
      } while(board[x][y] === 1 || oob(x, y) || banned.some(b => b[0] === x && b[1] === y));
      board[x][y] = 1;
    };

    // place mines on the board
    for(let i = 0; i < mines; i++)
      placeMine();

    // determine if a coordinate is a mine
    board.isMine = (x, y) => x >= 0 && x < width && y >= 0 && y < height && board[x][y] === 1;

    // count mines around a cell
    board.count = (x, y) => [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
      .map(n => [x+n[0], y+n[1]])
      .filter(([nx, ny]) => nx >= 0 && nx < width && ny >= 0 && ny < height && board[nx][ny] === 1)
      .length;

    return board;
  }

  // finds the game a player is over
  static findGame(x, y, ignore) {
    return global.minesweepers.find(game =>
      x >= game.left && y >= game.top && y < game.bottom && x < game.right && (ignore || game.inProgress));
  }

  // determine if a user trusts another player
  static hasTrust(owner, user) {
    return owner === user || global.minesweeperTrust[owner] && global.minesweeperTrust[owner].includes(user);
  }
}

module.exports = Minesweeper;