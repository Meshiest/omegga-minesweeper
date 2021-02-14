# minesweeper plugin

A playable minesweeper plugin for [omegga](https://github.com/brickadia-community/omegga).

## Install

* `git clone https://github.com/meshiest/omegga-minesweeper minesweeper` in `plugins` directory
* `npm i` in `minesweeper` directory

## Screenshot

![](https://i.imgur.com/pQUuwNp.png)

## Commands

Note: `!ms:command` can be interchanged with `!ms command`

* `!ms:start` - start a game below your player
  * `!ms:start size:50` - start a 50x50 game
  * `!ms:start width:10 height:15` - start a 10x15 game
  * `!ms:start mines:5` - start a game with 5 mines
  * `!ms:start size:30 mines:100` - start a 30x30 game with 100 mines
* `!ms:mine` - mine in a game below your player
* `!ms:stats` - get stats for the game below your player
* `!ms:clearall` - host only - clear all bricks and games
* `!ms:trust <player>` - trust a player to play on your board
