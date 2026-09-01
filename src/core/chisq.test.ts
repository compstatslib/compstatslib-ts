/**
 * Tests for R's chi-square distribution functions, `pchisq()` and `qchisq()`,
 * central and noncentral.
 *
 * Every expected value below comes from R 4.5.3, printed at full double
 * precision with `sprintf("%.17g", x)`. Do not edit these numbers by hand.
 * Source: `.claude/plans/004-PLAN-seminr-utilities/distributions-fixtures.md`,
 * sections 1, 2 and 3. The canonical generator is the R script
 * `../compstatslib/conformance-fixtures/distributions.R`.
 *
 * The grids hold the exact doubles the fixture prints, so `0.025` appears as
 * `0.025000000000000001` and `1 - 1e-8` as `0.99999998999999995`. Most are
 * the same double as the plain literal. At the far ends the `%.17g` print
 * does not read back as the double R started from: `9.9999999999999936e-301`
 * sits three units in the last place below `1e-300`. The tests pass the
 * printed doubles, and that gap moves a quantile far less than the tolerance
 * below allows.
 *
 * Both tails are pinned at every point. The upper tail is where a port that
 * subtracts from one loses its digits, so `{ lowerTail: false }` carries as
 * much of this file as the default does.
 */

import { describe, expect, test } from "bun:test";

import { pchisq, qchisq } from "./chisq.js";

/**
 * Relative tolerance for all comparisons against R.
 *
 * This is the `tdist.test.ts` convention. R reaches these values through its
 * own incomplete-gamma routines and the port through its regularized gamma,
 * so the two agree to a few units in the last place.
 */
const RELATIVE_TOLERANCE = 1e-12;

/**
 * Assert that a value agrees with R to a relative tolerance.
 *
 * The floor at 1e-300 keeps the rule usable on the far tails, where a
 * relative bound would fall below the smallest double and demand agreement no
 * routine can promise. A value R reports as exactly zero is pinned as zero,
 * because it underflows there in any implementation.
 */
function expectCloseToR(
  actual: number,
  expected: number,
  tolerance: number = RELATIVE_TOLERANCE,
): void {
  if (expected === 0) {
    expect(actual).toBe(0);
    return;
  }
  const bound = tolerance * Math.max(Math.abs(expected), 1e-300);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(bound);
}

/** One `x` and the two tail probabilities R reports there. */
type ProbabilityRow = readonly [x: number, lower: number, upper: number];

/** One probability and the two quantiles R reports for it. */
type QuantileRow = readonly [p: number, lower: number, upper: number];

/** All R probabilities for one degrees-of-freedom setting. */
interface CentralProbabilityFixture {
  readonly df: number;
  readonly rows: readonly ProbabilityRow[];
}

/** All R probabilities for one degrees-of-freedom and noncentrality pair. */
interface NonCentralProbabilityFixture {
  readonly df: number;
  readonly ncp: number;
  readonly rows: readonly ProbabilityRow[];
}

/** All R quantiles for one degrees-of-freedom setting. */
interface QuantileFixture {
  readonly df: number;
  readonly rows: readonly QuantileRow[];
}

/** Section 1a: the central grid, both tails, at five degrees of freedom. */
const centralProbabilities: readonly CentralProbabilityFixture[] = [
  {
    df: 1,
    rows: [
      [1e-08, 7.9788455947305779e-05, 0.99992021154405275],
      [0.001, 0.025227120630039609, 0.97477287936996038],
      [0.10000000000000001, 0.24817036595415071, 0.75182963404584924],
      [0.5, 0.52049987781304652, 0.47950012218695343],
      [1, 0.68268949213708596, 0.31731050786291415],
      [2, 0.842700792949716, 0.157299207050284],
      [5, 0.9746526813225318, 0.025347318677468245],
      [10, 0.9984345977419975, 0.001565402258002551],
      [30, 0.99999995679536946, 4.3204630578274975e-08],
      [60, 0.99999999999999056, 9.4857375710738494e-15],
      [100, 1, 1.5239706048321054e-23],
      [200, 1, 2.0884875837625449e-45],
      [250, 1, 2.5968070393401867e-56],
      [300, 1, 3.294362383314041e-67],
      [500, 1, 9.5053977665540912e-111],
      [1000, 1, 1.7958327848007259e-219],
    ],
  },
  {
    df: 2,
    rows: [
      [1e-08, 4.9999999874999999e-09, 0.99999999500000003],
      [0.001, 0.0004998750208307295, 0.99950012497916929],
      [0.10000000000000001, 0.048770575499285991, 0.95122942450071402],
      [0.5, 0.22119921692859512, 0.77880078307140488],
      [1, 0.39346934028736658, 0.60653065971263342],
      [2, 0.63212055882855767, 0.36787944117144233],
      [5, 0.91791500137610116, 0.0820849986238988],
      [10, 0.99326205300091452, 0.006737946999085467],
      [30, 0.99999969409767953, 3.0590232050182579e-07],
      [60, 0.99999999999990641, 9.3576229688401748e-14],
      [100, 1, 1.9287498479639178e-22],
      [200, 1, 3.7200759760208361e-44],
      [250, 1, 5.166420632837861e-55],
      [300, 1, 7.1750959731644108e-66],
      [500, 1, 2.6691902155412764e-109],
      [1000, 1, 7.1245764067412855e-218],
    ],
  },
  {
    df: 5,
    rows: [
      [1e-08, 5.319230386355185e-22, 0.99999999999999989],
      [0.001, 1.6814877189706274e-09, 0.99999999831851227],
      [0.10000000000000001, 0.00016231661192261506, 0.99983768338807744],
      [0.5, 0.0078767067673704057, 0.9921232932326296],
      [1, 0.03743422675270363, 0.96256577324729642],
      [2, 0.15085496391539036, 0.84914503608460967],
      [5, 0.58411981300449212, 0.41588018699550794],
      [10, 0.92476475385348778, 0.075235246146512197],
      [30, 0.99998525141896155, 1.4748581038443054e-05],
      [60, 0.99999999998784539, 1.2154569777183041e-11],
      [100, 1, 5.28514836094324e-20],
      [200, 1, 2.8406228986415315e-41],
      [250, 1, 5.4969224674551722e-52],
      [300, 1, 1.0015302305957845e-62],
      [500, 1, 7.9846611105628018e-106],
      [1000, 1, 6.0100776879208033e-214],
    ],
  },
  {
    df: 30,
    rows: [
      [1e-08, 2.333729155265423e-137, 1],
      [0.001, 2.3326354880142099e-62, 1],
      [0.10000000000000001, 2.2268695366738677e-32, 0.99999999999999989],
      [0.5, 5.6345587204509913e-22, 1],
      [1, 1.4610500924439225e-17, 1],
      [2, 3.0000106665252018e-13, 0.99999999999970002],
      [5, 6.9153138669928861e-08, 0.99999993084686134],
      [10, 0.00022625367617675558, 0.99977374632382321],
      [30, 0.5343462910559903, 0.46565370894400965],
      [60, 0.99907931760385138, 0.00092068239614866631],
      [100, 0.99999999814319762, 1.8568023365102387e-09],
      [200, 1, 4.9527335290031908e-27],
      [250, 1, 1.5157414203687211e-36],
      [300, 1, 2.6480484856308771e-46],
      [500, 1, 1.2079559936813978e-86],
      [1000, 1, 5.131435321572533e-191],
    ],
  },
  {
    df: 200,
    rows: [
      [1e-08, 0, 1],
      [0.001, 0, 1],
      [0.10000000000000001, 8.0444638471736372e-289, 1],
      [0.5, 5.2059487067099018e-219, 1],
      [1, 5.1523427339717521e-189, 0.99999999999999989],
      [2, 3.9812808189568546e-159, 1],
      [5, 5.6123327362440568e-120, 1],
      [10, 5.9918783035356518e-91, 1],
      [30, 1.5645857689298614e-47, 1],
      [60, 7.3384686328783343e-24, 1],
      [100, 3.2000653245851258e-10, 0.99999999967999342],
      [200, 0.51329879827914882, 0.48670120172085113],
      [250, 0.99062086833117391, 0.0093791316688260976],
      [300, 0.99999407545966457, 5.9245403354839159e-06],
      [500, 1, 1.1737017704487873e-27],
      [1000, 1, 1.5008794119250894e-106],
    ],
  },
];

/** Section 2a: the quantile grid, both tails, at five degrees of freedom. */
const centralQuantiles: readonly QuantileFixture[] = [
  {
    df: 1,
    rows: [
      [9.9999999999999936e-301, 0, 1373.8726312223939],
      [9.9999999999999977e-101, 1.5707963267948823e-200, 453.94308223879898],
      [9.9999999999999998e-17, 1.5707963267948839e-32, 68.969460958516564],
      [1e-08, 1.5707963267948893e-16, 32.841253361236788],
      [0.001, 1.5707971492624904e-06, 10.827566170662729],
      [0.01, 0.00015708785790970206, 6.6348966010212171],
      [0.025000000000000001, 0.00098206911717525617, 5.0238861873148872],
      [0.050000000000000003, 0.0039321400000195249, 3.8414588206941258],
      [0.10000000000000001, 0.015790774093431229, 2.7055434540954155],
      [0.25, 0.10153104426762159, 1.3233036969314669],
      [0.5, 0.45493642311957283, 0.45493642311957283],
      [0.75, 1.3233036969314669, 0.10153104426762159],
      [0.90000000000000002, 2.7055434540954155, 0.015790774093431218],
      [0.94999999999999996, 3.8414588206941263, 0.0039321400000195302],
      [0.97499999999999998, 5.0238861873148899, 0.00098206911717525769],
      [0.98999999999999999, 6.6348966010212136, 0.00015708785790970227],
      [0.999, 10.827566170662731, 1.5707971492624932e-06],
      [0.99999998999999995, 32.841253351468858, 1.5707963425806362e-16],
      [0.99999999999900002, 50.844171332448063, 1.5707268301301782e-24],
      [0.99999999999999989, 68.763252211668416, 1.9361559566769727e-32],
    ],
  },
  {
    df: 2,
    rows: [
      [9.9999999999999936e-301, 1.9999999999999374e-300, 1381.5510557964274],
      [9.9999999999999977e-101, 1.9999999999999815e-100, 460.51701859880916],
      [9.9999999999999998e-17, 1.9999999999999968e-16, 73.682722975809469],
      [1e-08, 2.0000000099999939e-08, 36.841361487904734],
      [0.001, 0.002001000667167067, 13.815510557964274],
      [0.01, 0.020100671707002884, 9.2103403719761818],
      [0.025000000000000001, 0.050635615968579753, 7.3777589082278681],
      [0.050000000000000003, 0.10258658877510107, 5.9914645471079808],
      [0.10000000000000001, 0.21072103131565262, 4.6051701859880918],
      [0.25, 0.57536414490356191, 2.7725887222397811],
      [0.5, 1.3862943611198906, 1.3862943611198906],
      [0.75, 2.7725887222397811, 0.57536414490356191],
      [0.90000000000000002, 4.6051701859880918, 0.21072103131565256],
      [0.94999999999999996, 5.9914645471079799, 0.10258658877510116],
      [0.97499999999999998, 7.3777589082278707, 0.050635615968579795],
      [0.98999999999999999, 9.2103403719761818, 0.020100671707002901],
      [0.999, 13.815510557964272, 0.0020010006671670687],
      [0.99999998999999995, 36.841361477855216, 2.0000000200495157e-08],
      [0.99999999999900002, 55.262086475786717, 1.9999557565607623e-12],
      [0.99999999999999989, 73.473601139354201, 2.2204460492503185e-16],
    ],
  },
  {
    df: 5,
    rows: [
      [9.9999999999999936e-301, 3.2334077805831867e-120, 1400.6405856530271],
      [9.9999999999999977e-101, 3.2334077805831046e-40, 476.37943706416274],
      [9.9999999999999998e-17, 1.2872430594871136e-06, 84.411683100633269],
      [1e-08, 0.0020407372249365316, 45.794587123084568],
      [0.001, 0.21021260262921918, 20.515005652432876],
      [0.01, 0.55429807672827713, 15.086272469388993],
      [0.025000000000000001, 0.8312116134866625, 12.832501994030029],
      [0.050000000000000003, 1.145476226061769, 11.070497693516351],
      [0.10000000000000001, 1.6103079869623227, 9.2363568997811196],
      [0.25, 2.6746028094321637, 6.6256797638292513],
      [0.5, 4.3514601910955282, 4.3514601910955282],
      [0.75, 6.6256797638292513, 2.6746028094321637],
      [0.90000000000000002, 9.2363568997811196, 1.6103079869623229],
      [0.94999999999999996, 11.070497693516351, 1.1454762260617695],
      [0.97499999999999998, 12.832501994030025, 0.83121161348666273],
      [0.98999999999999999, 15.086272469388987, 0.55429807672827736],
      [0.999, 20.515005652432876, 0.21021260262921926],
      [0.99999998999999995, 45.794587112362635, 0.0020407372290394128],
      [0.99999999999900002, 65.238682522364158, 5.1245981498259486e-05],
      [0.99999999999999989, 84.195032236521314, 1.3422229311410813e-06],
    ],
  },
  {
    df: 30,
    rows: [
      [9.9999999999999936e-301, 1.2846849499559548e-19, 1516.8812320054694],
      [9.9999999999999977e-101, 2.7677700613391754e-06, 568.42757044912014],
      [9.9999999999999998e-17, 1.1418532490733395, 143.34607734745939],
      [1e-08, 4.3012028318871689, 95.328831531183511],
      [0.001, 11.587951045645056, 59.70306430442993],
      [0.01, 14.953456528455437, 50.892181311517085],
      [0.025000000000000001, 16.790772265566627, 46.979242243671159],
      [0.050000000000000003, 18.492660981953467, 43.772971825742182],
      [0.10000000000000001, 20.599234614585349, 40.256023738711797],
      [0.25, 24.477607664886264, 34.799742519140921],
      [0.5, 29.336031516661588, 29.336031516661588],
      [0.75, 34.799742519140921, 24.477607664886264],
      [0.90000000000000002, 40.256023738711804, 20.599234614585342],
      [0.94999999999999996, 43.772971825742182, 18.49266098195347],
      [0.97499999999999998, 46.979242243671152, 16.790772265566627],
      [0.98999999999999999, 50.892181311517085, 14.953456528455442],
      [0.999, 59.70306430442993, 11.58795104564506],
      [0.99999998999999995, 95.328831517115688, 4.3012028335494676],
      [0.99999999999900002, 120.05209206745775, 2.1792697387651825],
      [0.99999999999999989, 143.08718275508076, 1.1501376776073966],
    ],
  },
  {
    df: 200,
    rows: [
      [9.9999999999999936e-301, 0.076013977833883625, 2034.6208577094278],
      [9.9999999999999977e-101, 7.9015976170801263, 966.43906044512391],
      [9.9999999999999998e-17, 76.821595610311419, 411.28775683052419],
      [1e-08, 107.24289708616725, 333.2597044265313],
      [0.001, 143.84279499000078, 267.54052782275721],
      [0.01, 156.43196610759165, 249.44512298144161],
      [0.025000000000000001, 162.7279825018463, 241.05789550631096],
      [0.050000000000000003, 168.27855443662835, 233.99426889232495],
      [0.10000000000000001, 174.83527299918737, 226.02104771968897],
      [0.25, 186.17166767424345, 213.10218505395284],
      [0.5, 199.33372983863086, 199.33372983863086],
      [0.75, 213.10218505395284, 186.17166767424345],
      [0.90000000000000002, 226.02104771968897, 174.83527299918737],
      [0.94999999999999996, 233.99426889232495, 168.27855443662841],
      [0.97499999999999998, 241.05789550631096, 162.72798250184633],
      [0.98999999999999999, 249.44512298144159, 156.43196610759165],
      [0.999, 267.54052782275721, 143.84279499000081],
      [0.99999998999999995, 333.25970440226263, 107.24289709752081],
      [0.99999999999900002, 374.49600347340618, 89.772008528974965],
      [0.99999999999999989, 410.88769099060903, 76.950927806842017],
    ],
  },
];

/** Section 3a: the noncentral grid over nine degrees-of-freedom and ncp pairs. */
const nonCentralProbabilities: readonly NonCentralProbabilityFixture[] = [
  {
    df: 5,
    ncp: 0.5,
    rows: [
      [0.5, 0.0062428990542627303, 0.99375710094573722],
      [2, 0.12551578884101217, 0.87448421115898789],
      [5, 0.52529351811629355, 0.47470648188370634],
      [10, 0.89499240036407435, 0.10500759963592558],
      [30, 0.99995545393036578, 4.4546069634230351e-05],
      [60, 0.99999999990113309, 9.8866759431373332e-11],
      [100, 1, 1.3188597244898156e-18],
      [200, 1, 6.8593563861958278e-39],
      [300, 1, 1.5458257222218024e-59],
      [500, 1, 2.6049368062567948e-101],
    ],
  },
  {
    df: 5,
    ncp: 5,
    rows: [
      [0.5, 0.00076825586583487452, 0.99923174413416538],
      [2, 0.023166712644522032, 0.97683328735547803],
      [5, 0.17885216700209458, 0.82114783299790528],
      [10, 0.5655776697663295, 0.43442233023367055],
      [30, 0.99637027986588123, 0.0036297201341187976],
      [60, 0.99999978756436902, 2.1243563103360044e-07],
      [100, 0.9999999999999194, 8.0688956535926193e-14],
      [200, 1, 2.1521494399856228e-31],
      [300, 1, 5.6972703041756075e-50],
      [500, 1, 9.8521747657879009e-89],
    ],
  },
  {
    df: 5,
    ncp: 50,
    rows: [
      [0.5, 4.9744303317604682e-13, 0.99999999999950262],
      [2, 2.1667049318634671e-10, 0.99999999978332954],
      [5, 5.2239671663002917e-08, 0.99999994776032841],
      [10, 7.6361959420502415e-06, 0.99999236380405798],
      [30, 0.027690087861347603, 0.97230991213865248],
      [60, 0.65688441600492797, 0.34311558399507247],
      [100, 0.99644685303486669, 0.003553146965133488],
      [200, 0.99999999999689637, 3.1036830430849907e-12],
      [300, 1, 3.5545093841027611e-24],
      [500, 1, 1.2386633568393226e-52],
    ],
  },
  {
    df: 30,
    ncp: 0.5,
    rows: [
      [0.5, 4.4053556876163926e-22, 1],
      [2, 2.3730437579176407e-13, 0.99999999999976275],
      [5, 5.5976684923516929e-08, 0.99999994402331505],
      [10, 0.00019013718662165763, 0.99980986281337847],
      [30, 0.50894980693494096, 0.49105019306505893],
      [60, 0.99879301186604053, 0.0012069881339595234],
      [100, 0.99999999666782413, 3.3321757304210591e-09],
      [200, 1, 1.9244848592665961e-26],
      [300, 1, 2.1655483691474732e-45],
      [500, 1, 4.0554678322734323e-85],
    ],
  },
  {
    df: 30,
    ncp: 5,
    rows: [
      [0.5, 4.8089823430053005e-23, 1],
      [2, 2.8752734549222037e-14, 0.99999999999997136],
      [5, 8.3201391417445223e-09, 0.99999999167986087],
      [10, 3.9200700219885944e-05, 0.9999607992997801],
      [30, 0.30775057363039637, 0.69224942636960385],
      [60, 0.99186804848090282, 0.0081319515190971092],
      [100, 0.99999981074819266, 1.8925180735931778e-07],
      [200, 1, 1.1449174864712904e-22],
      [300, 1, 6.7775585184894919e-40],
      [500, 1, 9.4114044190932639e-77],
    ],
  },
  {
    df: 30,
    ncp: 50,
    rows: [
      [0.5, 1.1510602490267422e-32, 1],
      [2, 1.8537474901213001e-23, 1],
      [5, 3.2551949233937983e-17, 1],
      [10, 2.1259375004801318e-12, 0.99999999999787414],
      [30, 4.3711611862113312e-05, 0.99995628838813766],
      [60, 0.09993568276965345, 0.90006431723034674],
      [100, 0.8882318347658934, 0.11176816523410658],
      [200, 0.99999999217855329, 7.821446744851122e-09],
      [300, 1, 1.2767301052982268e-19],
      [500, 1, 2.8599420389686495e-46],
    ],
  },
  {
    df: 200,
    ncp: 0.5,
    rows: [
      [0.5, 4.0569065461562944e-219, 1],
      [2, 3.1083080919010952e-159, 1],
      [5, 4.3980129808511827e-120, 1],
      [10, 4.7245585032937732e-91, 1],
      [30, 1.2645041666029798e-47, 1],
      [60, 6.1537359719956495e-24, 1],
      [100, 2.8171715039956696e-10, 0.99999999971828268],
      [200, 0.50334686545313501, 0.49665313454686488],
      [300, 0.99999324485785546, 6.7551421445610724e-06],
      [500, 1, 1.7114347515649125e-27],
    ],
  },
  {
    df: 200,
    ncp: 5,
    rows: [
      [0.5, 4.2998271636912706e-220, 1],
      [2, 3.3499175131050317e-160, 1],
      [5, 4.9008007578689081e-121, 1],
      [10, 5.5656541741374528e-92, 1],
      [30, 1.8592909174566267e-48, 1],
      [60, 1.2586710192221906e-24, 1],
      [100, 8.8907928477735487e-11, 0.9999999999110919],
      [200, 0.41581781667503448, 0.58418218332496552],
      [300, 0.99997927361899108, 2.0726381009111689e-05],
      [500, 1, 4.340267352743999e-26],
    ],
  },
  {
    df: 200,
    ncp: 50,
    rows: [
      [0.5, 7.6913698795108491e-230, 1],
      [2, 7.0797658667100642e-170, 1],
      [5, 1.4442859382462352e-130, 1],
      [10, 2.8458822876965431e-101, 1],
      [30, 8.2974084305315184e-57, 1],
      [60, 1.3014230480466084e-31, 1],
      [100, 5.0252195400387691e-16, 0.99999999999999956],
      [200, 0.015430528595443069, 0.98456947140455708],
      [300, 0.97461928190365887, 0.025380718096341431],
      [500, 1, 3.1685207233505203e-16],
    ],
  },
];

/**
 * Section 3b: the RMSEA walk.
 *
 * A fit measure holds the chi-square and the degrees of freedom fixed and
 * searches over the noncentrality parameter, so this is the shape the
 * noncentral branch has to hold. Each row is `[ncp, lower, upper]` at
 * `x = 300` and `df = 200`.
 */
const rmseaWalk: readonly (readonly [ncp: number, lower: number, upper: number])[] = [
  [0, 0.99999407545966457, 5.9245403354839159e-06],
  [1, 0.99999230841916575, 7.6915808342569253e-06],
  [10, 0.9999357967460446, 6.4203253955495869e-05],
  [50, 0.97461928190365887, 0.025380718096341431],
  [100, 0.51175787497456438, 0.48824212502543562],
  [150, 0.051802171546259587, 0.94819782845374045],
  [200, 0.00093634359383977018, 0.99906365640616024],
  [300, 5.2603631745678635e-09, 0.99999999473963674],
  [400, 5.530618966259654e-16, 0.99999999999999944],
];

/** Section 3d: three points where the noncentrality parameter is large. */
const largeNcp: readonly (readonly [
  x: number,
  df: number,
  ncp: number,
  lower: number,
  upper: number,
])[] = [
  [1500, 200, 1000, 0.99999027439442378, 9.7256055762162674e-06],
  [50, 5, 80, 0.016799689150664487, 0.98320031084933546],
  [200, 30, 100, 0.99830413035143117, 0.0016958696485688263],
];

describe("pchisq, central", () => {
  for (const fixture of centralProbabilities) {
    test(`matches R in both tails over the grid at df = ${fixture.df}`, () => {
      for (const [x, lower, upper] of fixture.rows) {
        expectCloseToR(pchisq(x, fixture.df), lower);
        expectCloseToR(pchisq(x, fixture.df, undefined, { lowerTail: false }), upper);
      }
    });
  }

  test("reports R's boundary values", () => {
    expect(pchisq(0, 5)).toBe(0);
    expect(pchisq(0, 5, undefined, { lowerTail: false })).toBe(1);
    expect(pchisq(-1, 5)).toBe(0);
    expect(pchisq(-1, 5, undefined, { lowerTail: false })).toBe(1);
    expect(pchisq(Number.POSITIVE_INFINITY, 5)).toBe(1);
    expect(pchisq(Number.POSITIVE_INFINITY, 5, undefined, { lowerTail: false })).toBe(0);
  });

  /**
   * R treats zero degrees of freedom as a point mass at zero, left open: the
   * probability is one above the mass and zero at the mass itself.
   */
  test("treats zero degrees of freedom as R's point mass at zero", () => {
    expect(pchisq(1, 0)).toBe(1);
    expect(pchisq(1, 0, undefined, { lowerTail: false })).toBe(0);
    expect(pchisq(0, 0)).toBe(0);
  });

  test("reports NaN where R warns that NaNs were produced", () => {
    expect(pchisq(1, -1)).toBeNaN();
    expect(pchisq(Number.NaN, 5)).toBeNaN();
  });
});

describe("qchisq", () => {
  for (const fixture of centralQuantiles) {
    test(`matches R in both tails over the grid at df = ${fixture.df}`, () => {
      for (const [p, lower, upper] of fixture.rows) {
        expectCloseToR(qchisq(p, fixture.df), lower);
        expectCloseToR(qchisq(p, fixture.df, { lowerTail: false }), upper);
      }
    });
  }

  test("reports R's boundary values", () => {
    expect(qchisq(0, 5)).toBe(0);
    expect(qchisq(1, 5)).toBe(Number.POSITIVE_INFINITY);
    expect(qchisq(0, 5, { lowerTail: false })).toBe(Number.POSITIVE_INFINITY);
    expect(qchisq(1, 5, { lowerTail: false })).toBe(0);
  });

  test("reports NaN where R warns that NaNs were produced", () => {
    expect(qchisq(1.5, 3)).toBeNaN();
    expect(qchisq(-0.1, 3)).toBeNaN();
    expect(qchisq(0.5, -1)).toBeNaN();
  });

  /**
   * The round trip is held to the central part of the grid, where the
   * probability carries all of its digits. In the far tails the derivative of
   * the probability is steep enough that the two directions disagree by more
   * than a rounding, which says nothing about either one.
   */
  test("inverts pchisq over the central part of the grid", () => {
    for (const fixture of centralQuantiles) {
      for (const [p] of fixture.rows) {
        if (p >= 1e-08 && p <= 0.999) {
          expectCloseToR(pchisq(qchisq(p, fixture.df), fixture.df), p, 1e-10);
        }
      }
    }
  });
});

describe("pchisq, noncentral", () => {
  for (const fixture of nonCentralProbabilities) {
    test(`matches R in both tails at df = ${fixture.df}, ncp = ${fixture.ncp}`, () => {
      for (const [x, lower, upper] of fixture.rows) {
        expectCloseToR(pchisq(x, fixture.df, fixture.ncp), lower);
        expectCloseToR(
          pchisq(x, fixture.df, fixture.ncp, { lowerTail: false }),
          upper,
        );
      }
    });
  }

  test("matches R over the RMSEA walk at x = 300 and df = 200", () => {
    for (const [ncp, lower, upper] of rmseaWalk) {
      expectCloseToR(pchisq(300, 200, ncp), lower);
      expectCloseToR(pchisq(300, 200, ncp, { lowerTail: false }), upper);
    }
  });

  /**
   * The RMSEA bounds come from a root search over the noncentrality
   * parameter, which needs the probability to fall as the parameter rises.
   */
  test("falls with the noncentrality parameter over the RMSEA walk", () => {
    const lower = rmseaWalk.map(([ncp]) => pchisq(300, 200, ncp));
    lower.forEach((value, index) => {
      if (index > 0) {
        expect(value).toBeLessThan(lower[index - 1] as number);
      }
    });
  });

  /** Fixture 3c: R's noncentral path at ncp = 0 returns the central value. */
  test("returns the central value bit for bit at ncp = 0", () => {
    for (const [x, df] of [
      [5, 5],
      [30, 30],
      [300, 200],
    ] as const) {
      expect(pchisq(x, df, 0)).toBe(pchisq(x, df));
      expect(pchisq(x, df, 0, { lowerTail: false })).toBe(
        pchisq(x, df, undefined, { lowerTail: false }),
      );
    }
  });

  /**
   * The upper tail here is a subtraction, so it is held to an absolute bound.
   *
   * At a noncentrality of 80 or more R's `pnchisq` sums the lower tail and
   * reports `1 - ans` for the other side. The upper tail therefore carries
   * the lower tail's *absolute* error rather than its relative one. Every
   * term of that sum is scaled by `exp(-lgamma(df/2 + 1))`, and one unit in
   * the last place of `lgamma(101)` is 5.7e-14, so a port that does not share
   * R's `lgamma` bit for bit cannot hold 1e-12 relative on
   * `pchisq(1500, 200, 1000, lower.tail = FALSE)`, which R gives as 9.7e-06.
   * The lower tail at that point is pinned at the usual 1e-12 relative, and
   * the upper tail at 1e-12 relative with an absolute floor of 1e-12.
   */
  test("matches R where the noncentrality parameter is large", () => {
    for (const [x, df, ncp, lower, upper] of largeNcp) {
      expectCloseToR(pchisq(x, df, ncp), lower);
      const actual = pchisq(x, df, ncp, { lowerTail: false });
      const bound = Math.max(RELATIVE_TOLERANCE * Math.abs(upper), 1e-12);
      expect(Math.abs(actual - upper)).toBeLessThanOrEqual(bound);
    }
  });

  test("reports NaN for a negative noncentrality parameter, as R warns", () => {
    expect(pchisq(5, 5, -1)).toBeNaN();
  });
});
