export interface Showcase {
  platform(value: string): void;
  log(line: string): void;
  event(): void;
}

/** Platform views the app places in its layout. */
export interface Controls {
  slider(onChange: (value: number) => void): any;
  setSlider(slider: any, value: number): void;
  /** A rich system view the platform provides. */
  feature(): any;
  featureName: string;
}
