declare module 'smiles-drawer' {
  export class SmiDrawer {
    constructor(options?: Record<string, unknown>);
    draw(
      smiles: string,
      target: SVGSVGElement | HTMLCanvasElement | string,
      theme?: string,
      weights?: unknown,
      onError?: (err: unknown) => void
    ): void;
  }

  export class SvgDrawer {
    constructor(options?: Record<string, unknown>);
    draw(
      tree: unknown,
      target: SVGSVGElement | string | null,
      themeName?: string,
      weights?: boolean,
      infoOnly?: boolean
    ): SVGSVGElement;
  }

  export function parse(
    smiles: string,
    successCallback: (tree: unknown) => void,
    errorCallback?: (err: unknown) => void
  ): void;
}
