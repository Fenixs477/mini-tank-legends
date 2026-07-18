/* main.ts — entry point: imports all modules, sets up globals, boots the game */
import * as THREE from 'three';
import Peer from 'peerjs';
import * as nakamajs from 'nakama-js';

import { Game } from './game';
import { Menu } from './menu';

/* Set up window globals for legacy interop */
(window as any).THREE = THREE;
(window as any).Peer = Peer;
(window as any).nakamajs = nakamajs;

/* Bootstrap (moved from end of game.js) */
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const RapierMod = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0');
    if (RapierMod.default) {
      await RapierMod.default.init();
      (window as any).RAPIER = RapierMod.default;
    }
  } catch (e) {
    console.warn('Rapier init failed, physics disabled:', e);
  }
  let game: Game | null = null;
  try {
    game = new Game(Menu.settings);
    game.init();
  } catch (e) {
    console.error('BOOTSTRAP ERROR:', e, (e as Error).stack);
  }
  try {
    Menu.init(game);
    (window as any).Menu = Menu;
  } catch (e) {
    console.error('MENU INIT ERROR:', e, (e as Error).stack);
  }
  (window as any).__game = game;
});
