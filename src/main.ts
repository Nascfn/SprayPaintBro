import { Game } from './game/Game';

const debug = new URLSearchParams(location.search).has('debug');

// Texture generation blocks for a moment; give the start screen a chance to paint first.
setTimeout(() => {
  const game = new Game(document.getElementById('app')!, debug);
  game.start();
}, 30);
