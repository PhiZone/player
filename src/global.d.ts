declare module 'stats-js' {
  class StatsJS {
    dom: HTMLDivElement;

    constructor(): void;

    showPanel(id: number): void;
    begin(): void;
    end(): void;
    update(): void;
  }

  export = StatsJS;
}
