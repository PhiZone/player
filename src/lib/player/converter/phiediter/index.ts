import { beatToArray, getEventValue } from '$lib/player/utils';
import type {
  RpeJson,
  RpeMeta,
  JudgeLine,
  EventLayer,
  Event,
  SpeedEvent,
  Note,
  Bpm,
} from '$lib/types';
import type { PecCommandBase, PecNote } from './types';

const BEAT_BETWEEN_TIME = 0.125;

const PhiEditer = (chartRaw: string, meta: Omit<RpeMeta, 'offset'>): RpeJson => {
  const chartRawArr = chartRaw.split(/[\r\n]+/);
  const chartOffset = parseInt(chartRawArr.shift()!);
  if (isNaN(chartOffset)) throw new Error('Not a valid PhiEditer chart');

  const noteList: PecNote[] = [];
  const lineList: Record<number, JudgeLine> = {};
  const result: RpeJson = {
    BPMList: [],
    META: { ...meta, offset: chartOffset - 175 },
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
          positionX: (parseFloat(commandArr[3]) / 1024) * 675,
          above: commandArr[4] === '1' ? 1 : 0,
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
          positionX: (parseFloat(commandArr[4]) / 1024) * 675,
          above: commandArr[5] === '1' ? 1 : 0,
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
          start: parseFloat(commandArr[3]) * (9 / 14),
          end: parseFloat(commandArr[3]) * (9 / 14),
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

  // Parse events
  for (const id in lineList) {
    const line = lineList[id];
    const events = line.eventLayers[0]!;

    events.speedEvents!.sort(sortEvent);
    events.moveXEvents!.sort(sortEvent);
    events.moveYEvents!.sort(sortEvent);
    events.rotateEvents!.sort(sortEvent);
    events.alphaEvents!.sort(sortEvent);

    parseLineEvents(events.speedEvents!, 1);
    parseLineEvents(events.moveXEvents!);
    parseLineEvents(events.moveYEvents!);
    parseLineEvents(events.rotateEvents!);
    parseLineEvents(events.alphaEvents!, 255);
  }

  // Push notes to lines
  for (const note of noteList) {
    const newNote: Partial<PecNote> & Note = { ...note };
    const line = lineList[note.lineID];

    if (!line) {
      console.warn(`Cannot find line #${note.lineID} for note, skipping...`);
      continue;
    }

    delete newNote.lineID;
    line.notes!.push(newNote);
  }

  // Sort BPM
  result.BPMList.sort((a, b) => a.startBeat - b.startBeat);

  // Parse advanced alpha events
  for (const id in lineList) {
    const line = lineList[id];
    const alphaEvents = line.eventLayers[0]!.alphaEvents!;

    // Sort notes first
    line.notes!.sort((a, b) => a.startBeat - b.startBeat);

    for (const event of alphaEvents) {
      let hasNotesDuring = false;

      // XXX:
      // PhiEditer has four different alpha values, we will only support three of them.
      if (event.start < -100 && event.start >= -1000) {
        const beatBetween = event.endBeat - event.startBeat;
        const beatBetweenLength = Math.ceil(beatBetween / BEAT_BETWEEN_TIME);

        for (let i = 0; i < beatBetweenLength; i++) {
          const beatPassed = i * BEAT_BETWEEN_TIME;
          const currentBeat =
            event.startBeat + beatPassed > event.endBeat
              ? event.endBeat
              : event.startBeat + i * BEAT_BETWEEN_TIME;
          const currentValue = getEventValue(currentBeat, event) as number | undefined;

          if (!currentValue || currentValue >= -100) break;
          const visibleBeat = -(currentValue + 100) / 10;

          for (const note of line.notes!) {
            if (note.startBeat < currentBeat) continue;
            if (note.startBeat > currentBeat) break;

            note.visibleTime = getVisibleRealTime(result.BPMList, note.startBeat, visibleBeat);
            hasNotesDuring = true;
          }
        }

        event.start = hasNotesDuring ? 0 : -255;
      } else if (event.end < -1000) {
        console.warn(`Unsupported alpha value: ${event.start}, will be set to 0...`);
        event.start = 0;
      }

      if (event.end < -100 && event.end >= -1000) event.end = hasNotesDuring ? 0 : -255;
      else if (event.end < -1000) {
        console.warn(`Unsupported alpha value: ${event.start}, will be set to 0...`);
        event.start = 0;
      }
    }
  }

  // Push lines to result
  for (const id in lineList) {
    const line = lineList[id];
    result.judgeLineList.push(line);
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
      Texture: 'line.png',
      alphaControl: [
        {
          x: 0,
          alpha: 255,
          easing: 1,
        },
        {
          x: 9999999,
          alpha: 255,
          easing: 1,
        },
      ],
      bpmfactor: 1,
      father: -1,
      isCover: 1,
      notes: [],
      numOfNotes: 0,
      posControl: [
        {
          x: 0,
          pos: 1,
          easing: 1,
        },
        {
          x: 9999999,
          pos: 1,
          easing: 1,
        },
      ],
      sizeControl: [
        {
          x: 0,
          size: 1,
          easing: 1,
        },
        {
          x: 9999999,
          size: 1,
          easing: 1,
        },
      ],
      skewControl: [
        {
          x: 0,
          skew: 0,
          easing: 1,
        },
        {
          x: 9999999,
          skew: 0,
          easing: 1,
        },
      ],
      yControl: [
        {
          x: 0,
          y: 1,
          easing: 1,
        },
        {
          x: 9999999,
          y: 1,
          easing: 1,
        },
      ],
      zOrder: 0,
    };
  }

  const line = lineList[lineID];
  const events = line.eventLayers[0]!;
  if (type !== 'speedEvents') events[type]!.push(event as Event);
  else events.speedEvents!.push(event as SpeedEvent);
};

const sortEvent = (a: Event | SpeedEvent, b: Event | SpeedEvent) => a.startBeat - b.startBeat;

const parseLineEvents = (events: (Event | SpeedEvent)[], defaultValue = 0) => {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const eventPrev = events[i - 1];
    const eventNext = events[i + 1];

    if (isNaN(event.start)) {
      if (eventPrev) event.start = eventPrev.end;
      else event.start = defaultValue;
    }

    if (isNaN(event.endBeat)) {
      if (eventNext) {
        event.endTime = eventNext.startTime;
        event.endBeat = eventNext.startBeat;
      } else {
        event.endTime = [9999, 0, 1];
        event.endBeat = 9999;
      }
    }
  }

  return events;
};

const getVisibleRealTime = (bpms: Bpm[], startBeat: number, beat: number) => {
  const calcRealTime = (bpm: number, beat: number) => {
    return beat * (60 / bpm);
  };

  if (bpms.length === 1) return calcRealTime(bpms[0].bpm, beat);

  for (const bpm of bpms) {
    if (bpm.startBeat < startBeat) continue;
    if (bpm.startBeat > startBeat) break;

    return calcRealTime(bpm.bpm, beat);
  }

  return 9999999;
};

export default PhiEditer;
