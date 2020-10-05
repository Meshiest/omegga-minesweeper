/*
  cake's simple cooldown util
*/
module.exports = (length=1000) => {
  const lastCommand = {};

  return name => {
    const now = Date.now();

    const isOk = !lastCommand[name] || (lastCommand[name] + length < now);
    if (isOk) {
      lastCommand[name] = now;
    }

    return isOk;
  };
}