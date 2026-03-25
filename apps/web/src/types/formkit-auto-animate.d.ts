declare module "@formkit/auto-animate" {
  export interface AutoAnimateOptions {
    duration?: number;
    easing?: string;
    disrespectUserMotionPreference?: boolean;
  }

  export function autoAnimate(
    element: Element,
    options?: AutoAnimateOptions,
  ): (enabled?: boolean) => void;
}
