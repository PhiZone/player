import { Events } from 'phaser';

// Used to emit events between Svelte components and Phaser scenes
// https://newdocs.phaser.io/docs/3.70.0/Phaser.Events.EventEmitter
export const EventBus = new Events.EventEmitter();

let autostartBlocked = false;

export const setAutostartBlocked = (blocked: boolean) => {
  autostartBlocked = blocked;
};

export const isAutostartBlocked = () => autostartBlocked;
