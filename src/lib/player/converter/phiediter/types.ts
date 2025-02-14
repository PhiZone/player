import type { Note } from '$lib/types';

export type PhiEditerCommandTypeBPM = 'bp';
export type PhiEditerCommandTypeNote = 'n1' | 'n2' | 'n3' | 'n4';
export type PhiEditerCommandTypeNoteExtra = '#' | '&';
export type PhiEditerCommandTypeLine = 'cv' | 'cm' | 'cp' | 'cr' | 'cd' | 'cf' | 'ca';
export type PhiEditerCommandType =
  | PhiEditerCommandTypeBPM
  | PhiEditerCommandTypeNote
  | PhiEditerCommandTypeNoteExtra
  | PhiEditerCommandTypeLine;

export interface PhiEditerCommandBase extends Array<string> {
  0: PhiEditerCommandType;
}

export interface PhiEditerNote extends Note {
  lineID: number;
}
