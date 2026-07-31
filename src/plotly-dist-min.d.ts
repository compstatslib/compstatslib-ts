/**
 * The Plotly.js distribution ships no type declarations, and this port does
 * not install `@types/plotly.js`: the whole of Plotly's API is far larger than
 * the four calls the port makes, and a large declaration set would invite the
 * rest of the code to use it.
 *
 * The module is therefore declared as unknown here, and `src/plot/plotly.ts`
 * narrows the loaded object to its own `PlotlyLike` interface. That interface
 * is the contract the port draws through — see the doc comment there.
 */
declare module "plotly.js-dist-min" {
  const plotly: unknown;
  export default plotly;
}
