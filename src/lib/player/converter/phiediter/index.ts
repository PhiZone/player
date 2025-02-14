import { beatToArray } from '$lib/player/utils';
import type { RpeJson, RpeMeta, JudgeLine, EventLayer, Event, SpeedEvent } from '$lib/types';
import type { PecCommandBase, PecNote } from './types';

const PhiEditer = (chartRaw: string, meta: Omit<RpeMeta, 'offset'>): RpeJson => {
  const chartRawArr = chartRaw.split(/[\r\n]+/);
  const chartOffset = parseInt(chartRawArr.shift()!);
  if (isNaN(chartOffset)) throw new Error('Not a valid PhiEditer chart');

  const noteList: PecNote[] = [];
  const lineList: Record<number, JudgeLine> = {};
  const result: RpeJson = {
    BPMList: [],
    META: { ...meta, offset: chartOffset },
    chartTime: 0,
    judgeLineGroup: [],
    judgeLineList: [],
    multiLineString: '',
    multiScale: 0,
  };

  for (const command of chartRawArr) {
    const commandArr = command.split(/\s/) as PecCommandBase;

    switch (commandArr[0]) {
      // Parse BPMs
      case 'bp': {
        result.BPMList.push({
          startTime: beatToArray(commandArr[1]),
          startBeat: parseFloat(commandArr[1]),
          bpm: parseFloat(commandArr[2]),
          startTimeSec: 0,
        });
        break;
      }

      // Parse notes
      case 'n1': // Tap
      case 'n3': // Flick
      case 'n4': {
        // Drag
        const typeRaw = commandArr[0];
        noteList.push({
          type: typeRaw === 'n1' ? 1 : typeRaw === 'n3' ? 3 : 4,
          lineID: parseInt(commandArr[1]),
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: beatToArray(commandArr[2]),
          endBeat: parseFloat(commandArr[2]),
          positionX: ((parseFloat(commandArr[3]) * 9) / 1024) * 675,
          above: parseInt(commandArr[4]),
          isFake: parseInt(commandArr[5]),
          // Not implemented in PhiEditer
          alpha: 255,
          visibleTime: 999999,
          yOffset: 0,
          // Will be parsed later
          size: 0,
          speed: 0,
        });
        break;
      }
      case 'n2': {
        // Hold
        noteList.push({
          type: 2,
          lineID: parseInt(commandArr[1]),
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: beatToArray(commandArr[3]),
          endBeat: parseFloat(commandArr[3]),
          positionX: ((parseFloat(commandArr[4]) * 9) / 1024) * 675,
          above: parseInt(commandArr[5]),
          isFake: parseInt(commandArr[6]),
          // Not implemented in PhiEditer
          alpha: 255,
          visibleTime: 999999,
          yOffset: 0,
          // Will be parsed later
          size: 0,
          speed: 0,
        });
        break;
      }
      case '#': {
        // Note speed
        noteList[noteList.length - 1].speed = parseFloat(commandArr[1]);
        break;
      }
      case '&': {
        // Note scale
        noteList[noteList.length - 1].size = parseFloat(commandArr[1]);
        break;
      }

      // Parse line events
      case 'cv': {
        // Speed events
        pushEventToLine(lineList, parseInt(commandArr[1]), 'speedEvents', {
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: [NaN, 0, 1],
          endBeat: NaN,
          start: parseFloat(commandArr[3]),
          end: parseFloat(commandArr[3]),
          linkgroup: 0,
        });
        break;
      }
      case 'cm': {
        // Move events
        // MoveX
        pushEventToLine(lineList, parseInt(commandArr[1]), 'moveXEvents', {
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: beatToArray(commandArr[3]),
          endBeat: parseFloat(commandArr[3]),
          start: NaN,
          end: (parseFloat(commandArr[4]) / 2048 - 0.5) * 2 * 675,
          easingType: parseInt(commandArr[6]),
          // Not implemented props
          bezier: 0,
          bezierPoints: [0, 0, 1, 1],
          easingLeft: 0,
          easingRight: 1,
          linkgroup: 0,
        });
        // MoveY
        pushEventToLine(lineList, parseInt(commandArr[1]), 'moveYEvents', {
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: beatToArray(commandArr[3]),
          endBeat: parseFloat(commandArr[3]),
          start: NaN,
          end: (parseFloat(commandArr[5]) / 1400 - 0.5) * 2 * 450,
          easingType: parseInt(commandArr[6]),
          // Not implemented props
          bezier: 0,
          bezierPoints: [0, 0, 1, 1],
          easingLeft: 0,
          easingRight: 1,
          linkgroup: 0,
        });
        break;
      }
      case 'cp': {
        // Move events (instant)
        // MoveX
        pushEventToLine(lineList, parseInt(commandArr[1]), 'moveXEvents', {
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: [NaN, 0, 1],
          endBeat: NaN,
          start: (parseFloat(commandArr[3]) / 2048 - 0.5) * 2 * 675,
          end: (parseFloat(commandArr[3]) / 2048 - 0.5) * 2 * 675,
          easingType: 1,
          // Not implemented props
          bezier: 0,
          bezierPoints: [0, 0, 1, 1],
          easingLeft: 0,
          easingRight: 1,
          linkgroup: 0,
        });
        // MoveY
        pushEventToLine(lineList, parseInt(commandArr[1]), 'moveYEvents', {
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: [NaN, 0, 1],
          endBeat: NaN,
          start: (parseFloat(commandArr[4]) / 1400 - 0.5) * 2 * 450,
          end: (parseFloat(commandArr[4]) / 1400 - 0.5) * 2 * 450,
          easingType: 1,
          // Not implemented props
          bezier: 0,
          bezierPoints: [0, 0, 1, 1],
          easingLeft: 0,
          easingRight: 1,
          linkgroup: 0,
        });
        break;
      }
      case 'cr': {
        // Rotate events
        pushEventToLine(lineList, parseInt(commandArr[1]), 'rotateEvents', {
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: beatToArray(commandArr[3]),
          endBeat: parseFloat(commandArr[3]),
          start: NaN,
          end: parseFloat(commandArr[4]),
          easingType: parseInt(commandArr[5]),
          // Not implemented props
          bezier: 0,
          bezierPoints: [0, 0, 1, 1],
          easingLeft: 0,
          easingRight: 1,
          linkgroup: 0,
        });
        break;
      }
      case 'cd': {
        // Rotate events (instant)
        pushEventToLine(lineList, parseInt(commandArr[1]), 'rotateEvents', {
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: [NaN, 0, 1],
          endBeat: NaN,
          start: parseFloat(commandArr[3]),
          end: parseFloat(commandArr[3]),
          easingType: 1,
          // Not implemented props
          bezier: 0,
          bezierPoints: [0, 0, 1, 1],
          easingLeft: 0,
          easingRight: 1,
          linkgroup: 0,
        });
        break;
      }
      case 'cf': {
        // Alpha events
        pushEventToLine(lineList, parseInt(commandArr[1]), 'alphaEvents', {
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: beatToArray(commandArr[3]),
          endBeat: parseFloat(commandArr[3]),
          start: NaN,
          end: parseFloat(commandArr[4]),
          easingType: 1,
          // Not implemented props
          bezier: 0,
          bezierPoints: [0, 0, 1, 1],
          easingLeft: 0,
          easingRight: 1,
          linkgroup: 0,
        });
        break;
      }
      case 'ca': {
        // Alpha events (instant)
        pushEventToLine(lineList, parseInt(commandArr[1]), 'alphaEvents', {
          startTime: beatToArray(commandArr[2]),
          startBeat: parseFloat(commandArr[2]),
          endTime: [NaN, 0, 1],
          endBeat: NaN,
          start: parseFloat(commandArr[3]),
          end: parseFloat(commandArr[3]),
          easingType: 1,
          // Not implemented props
          bezier: 0,
          bezierPoints: [0, 0, 1, 1],
          easingLeft: 0,
          easingRight: 1,
          linkgroup: 0,
        });
        break;
      }
      default: {
        if (commandArr[0] != '') console.warn(`Unsupported command: ${commandArr[0]}, skipping...`);
      }
    }
  }

  return result;
};

const pushEventToLine = (
  lineList: Record<number, JudgeLine>,
  lineID: number,
  type: keyof EventLayer,
  event: Event | SpeedEvent,
) => {
  // Create a line if that ID doesn't exist
  if (!lineList[lineID]) {
    lineList[lineID] = {
      eventLayers: [
        {
          speedEvents: [],
          moveXEvents: [],
          moveYEvents: [],
          alphaEvents: [],
          rotateEvents: [],
        },
      ],
      // We will ignore all of these props
      Name: '',
      Group: 0,
      Texture: '',
      alphaControl: [],
      bpmfactor: 1,
      father: -1,
      isCover: 1,
      notes: [],
      numOfNotes: 0,
      posControl: [],
      sizeControl: [],
      skewControl: [],
      yControl: [],
      zOrder: 0,
    };
  }

  const line = lineList[lineID];
  const events = line.eventLayers[0]!;
  if (type !== 'speedEvents') events[type]!.push(event as Event);
  else events.speedEvents!.push(event as SpeedEvent);
};

export default PhiEditer;
