/**
 * Tests for the moderation surface, ported from `plot_moderation_3d()` in
 * `../compstatslib/R/moderation_3d_plot.R`, which fits an `lm()` and calls
 * `predict()` over a 15 x 15 grid of the IV and the moderator.
 *
 * Every expected value below comes from R 4.5.3, printed with
 * `sprintf("%.17g", x)`. Do not edit these numbers by hand.
 * Source: `.claude/plans/001-PLAN-port/moderation-fixtures.md`, sections 2 to 4.
 *
 * R script that produced them, abridged to what these tests assert:
 *
 * ```r
 * load("../compstatslib/data/moderation_data.rda")
 * m1 <- lm(y ~ x * z,             data = moderation_data)   # M1
 * m2 <- lm(y ~ x + z,             data = moderation_data)   # M2
 * m3 <- lm(y ~ x + z + w + x:z,   data = moderation_data)   # M3
 * coef(m1); fitted(m1)
 *
 * seq_x <- seq(min(moderation_data$x), max(moderation_data$x), length.out = 15)
 * seq_z <- seq(min(moderation_data$z), max(moderation_data$z), length.out = 15)
 * grid  <- setNames(expand.grid(seq_x, seq_z), c("x", "z"))
 * grid$y <- predict(m1, grid)
 * range(c(moderation_data$y, grid$y))          # zlim
 *
 * grid3 <- grid; grid3$w <- mean(moderation_data$w)   # hold_value()
 * predict(m3, grid3)
 * ```
 *
 * The rank-deficient and constant-column fixtures at the end came from a
 * separate R run in this session, printed the same way:
 *
 * ```r
 * seq(3, 3, length.out = 15)                    # 15 copies of 3
 * d <- data.frame(y = c(3,5,4,8,10,9), x = c(1,2,3,4,5,6), z = c(2,1,4,3,6,5))
 * d$dup <- d$x
 * coef(lm(y ~ x + z + dup + x:z, data = d))     # dup aliases to NA
 * ```
 *
 * ## What is asserted exactly, and what carries a tolerance
 *
 * **The grid is exact.** R builds it with `seq(from, to, length.out = 15)`,
 * which is `from + i * by` in plain double arithmetic with both endpoints
 * pinned. All 30 grid coordinates are compared with `toBe`. Measured while
 * writing these tests: the plain form matches R on all 30, while a
 * single-rounding fused multiply-add — which `pretty.ts` needs for R's other
 * sequence path — misses 14 of them. The port must not "improve" this.
 *
 * **Everything the fit produces carries a tolerance.** These assertions were
 * written for `toBe` first, because slice 3 found the unweighted
 * `leastSquares()` path bit-identical to R on a two-column design. It does
 * not hold here. R's `lm()` and this port both run LINPACK's `dqrdc2`, but
 * over four or five columns of 200 rows the compiled Fortran and the
 * TypeScript accumulate the reflections a few bits apart. Measured against
 * the fixtures, worst relative margins under the metric below:
 *
 * ```text
 * coefficients        3.3e-16   (M1 and M2 intercepts land bit-exact)
 * fitted values       0         (200 of 200 bit-exact, all three models)
 * residuals           0         (200 of 200 bit-exact)
 * grid predictions    2.1e-15   (24 of 225 bit-exact)
 * zlim, hold value    2.7e-16
 * ```
 *
 * The fitted values and residuals moved to bit equality when the module was
 * rebased on `linalg/lm`: they now come out of `dqrsl` as R's do — the
 * residuals from the factorization and the fit as `y` minus them — instead
 * of being re-summed as `X · β`, which had left them 8.6e-15 out with only
 * 16 of 200 exact. The assertions stay on the tolerance, because the
 * coefficients and the grid still carry one; fixture 4h pins the first five
 * of each with `toEqual` as a tripwire.
 *
 * R's own `predict()` disagrees with a hand-summed linear combination of its
 * own coefficients by 3.6e-15 (fixture section 3), so summation order alone
 * already rules out bit equality for the surface. The relative tolerance is
 * this project's usual 1e-12, scaled by max(1, |expected|) — four orders of
 * magnitude above the worst margin measured.
 */

import { describe, expect, test } from "bun:test";

import { moderationData } from "../data/moderationData.js";
import type { DataFrame } from "./frame.js";
import { moderationSurface } from "./moderation.js";

/** Relative tolerance for values R accumulates in a different order. */
const RELATIVE_TOLERANCE = 1e-12;

function expectCloseToR(actual: number, expected: number): void {
  const tolerance = RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

/** `seq(min(x), max(x), length.out = 15)` over `moderation_data$x`. */
const SEQ_X: readonly number[] = [
  -5.9861801663058696, -5.1726114400919077, -4.3590427138779457,
  -3.5454739876639847, -2.7319052614500228, -1.9183365352360608,
  -1.1047678090220998, -0.29119908280813789, 0.52236964340582404,
  1.335938369619786, 2.1495070958337479, 2.9630758220477098, 3.77664454826167,
  4.5902132744756319, 5.4037820006895947,
];

/** `seq(min(z), max(z), length.out = 15)` over `moderation_data$z`. */
const SEQ_Z: readonly number[] = [
  -5.3998596171274054, -4.6627848517796746, -3.925710086431943,
  -3.1886353210842122, -2.451560555736481, -1.7144857903887498,
  -0.97741102504101907, -0.24033625969328742, 0.49673850565444333,
  1.2338132710021741, 1.9708880363499057, 2.7079628016976374,
  3.4450375670453672, 4.1821123323930989, 4.9191870977408296,
];

/** `coef(lm(y ~ x * z, moderation_data))`. */
const M1_COEFFICIENTS: readonly number[] = [
  -0.045294514450106065, 0.47201397160336289, 0.31362022773781534,
  0.84818280395686607,
];

/** `coef(lm(y ~ x + z, moderation_data))`. */
const M2_COEFFICIENTS: readonly number[] = [
  -0.30269734769222689, 0.5082163187632035, 0.66511076495257437,
];

/** `coef(lm(y ~ x + z + w + x:z, moderation_data))`. */
const M3_COEFFICIENTS: readonly number[] = [
  -0.046252109941790048, 0.47180209229612374, 0.31363421997396679,
  -0.003665271584484884, 0.84815858062951188,
];

/** All 200 of `fitted(m1)`. */
const M1_FITTED: readonly number[] = [
  -9.3130443937296636, -1.0085002297724963,
  2.4752805151804269, 6.2660758865938044,
  -2.4157444554560819, -0.45297439190631295,
  -2.6806799560756724, -0.45728888716621052,
  -2.9669158033125052, -0.18133168121728849,
  -4.8848126816420843, 19.19380946968942,
  -1.7966550903072183, -0.2816808068549419,
  -0.084461282683728434, 0.65925608380024536,
  -0.26910329709967407, -14.936514113291507,
  -0.68831639478610351, -5.3531822621203027,
  -0.49409004425329228, 0.17698576092418827,
  -0.23053323791163044, -3.9704206171291658,
  4.7668517127521897, -0.30667295475200518,
  -0.41481478479951173, -0.45481445780288737,
  -1.0519048056303522, -2.5799455715950379,
  -0.20573275502289912, 3.481545482592725,
  -4.0415598354852458, 0.050455306692650526,
  -0.19899747739789853, 0.36608192024210684,
  -3.5294099672556216, -0.79713456864976961,
  -4.1715804222057669, -0.71777912465823701,
  -0.81786906582984475, -0.98271833427194344,
  4.6969253851484201, -3.0270774467521413,
  4.2062253909924019, 4.6593505724182913,
  -2.9727357091209088, 1.1703183440658007,
  -1.0411882198029738, -2.1964219896163062,
  -1.6261699191304051, -0.88493650467498264,
  -5.7166915438427619, 1.0952745005825286,
  1.248610924663488, -1.4027550983021542,
  -1.569050132961908, 0.082908730671406472,
  6.8243017142901152, -0.38722419126659391,
  -0.93193756201538847, 1.3470046345522522,
  1.502429884763933, -8.678184221703571,
  -0.63251018161703687, 6.5576323131479759,
  1.7084132257456091, 0.14307901654886612,
  -9.3036052561744231, 0.8225842608245596,
  -2.7006676503904332, -0.11571802076063831,
  0.9750547031436172, -2.0708868429336755,
  -0.076157470642343267, 3.9070369223168671,
  2.200888010116727, -2.3422036059126632,
  -4.1668238693942161, -4.8221836821241508,
  6.1289549311119167, -2.2995752399893989,
  -0.4897190407001637, -0.021472605129139843,
  -1.3225133420354813, 1.4733272619416522,
  -0.51949953400408422, -0.22371107659324418,
  -7.1813192673358568, 1.6652325627873195,
  -2.4099589206055234, -0.93563377199453113,
  -1.7334005261783725, 13.095601644594193,
  -0.70530431842442132, 0.23671778322414805,
  -0.57958160723907048, -5.1521092148847512,
  0.11768138747641874, -4.0509092080727678,
  1.0667244643117233, 4.1125580426804058,
  -1.1006049772725934, 6.7707241207651361,
  -0.43527292080059621, -0.0027183143301307278,
  -0.83239706282989467, 0.049845780885896418,
  -1.4452337568632212, 0.032653655856807573,
  -0.10745176219700703, -0.69756372636145336,
  0.55118849293932803, 0.16206607595504641,
  -4.5523993010886237, -0.12732739634115209,
  0.34357915687026463, 4.1058704893143725,
  3.6083328937255397, 1.2273291922732121,
  0.69639578966960269, -2.2583222384349941,
  0.12600110172229595, -0.98548688372211835,
  1.0767139351679447, 0.23191256403325144,
  -2.2910278666849582, -2.153725148454861,
  1.7451154011155265, 0.039162108197818402,
  2.3970816491570668, -0.065934482935629646,
  -0.52968108576810802, 1.6925442401893087,
  6.7633960944121903, -0.85364910367913505,
  -0.473963266152711, -5.0571293065274237,
  0.25386466831271393, -0.33161763619953355,
  -0.13376245252528859, -2.4820345453352202,
  -0.081994214051757108, -0.66048677888015206,
  -0.90766214271225143, 2.2190672874624391,
  -1.6620811686676007, 0.96307953555668158,
  0.87377897220250123, -5.0440664473626331,
  0.27052290747564167, 2.3503298921068345,
  4.4167517637441946, -0.041029099472050246,
  -0.051677009429489051, -5.458269352373418,
  -0.22697213869539157, -2.5307062992788119,
  -0.20447497047642971, -6.7051625626926903,
  -0.23792736759705996, 2.2183009018672371,
  -0.46314925851518085, -0.18478826816241684,
  0.10851719880847543, -0.027761066660052069,
  -6.1683791196241984, -2.6233572648106138,
  -0.34482741222324353, 2.0797564370169539,
  -0.51028026596664477, 1.0512844186892485,
  -8.2518291323963311, -8.908324864624328,
  5.9218444832554749, -0.26752772734911523,
  -0.22762592414683924, -2.5544074689460916,
  0.71428049555968731, 1.0300453317501383,
  2.8615894729812141, 0.86183811763469165,
  1.2157109714970054, 2.4918859680494045,
  -0.24627159594882744, -0.45449365617124693,
  -0.29953218839443907, 1.9769365620274013,
  -3.9232822278848767, -4.8393564850654522,
  0.57167592791375543, -0.20698571992483003,
  0.93286900607288814, 0.80101759561680286,
  -0.21718058199941487, 5.7067577654522728,
  1.2186423763565322, 1.1391141925807562,
  -0.066176359956253483, 1.0672119796545749,
];

/** All 225 of `predict(m1, grid)`, the grid row order R's expand.grid gives. */
const M1_PREDICTIONS: readonly number[] = [
  22.852752254764869, 19.510567913877459,
  16.168383572990049, 12.826199232102642,
  9.484014891215228, 6.1418305503278159,
  2.7996462094404087, -0.54253813144700336,
  -3.8847224723344151, -7.2269068132218273,
  -10.569091154109239, -13.91127549499665,
  -17.253459835884055, -20.595644176771469,
  -23.937828517658883, 19.341508766003333,
  16.507946554832682, 13.674384343662032,
  10.840822132491382, 8.0072599213207329,
  5.1736977101500825, 2.3401354989794343,
  -0.49342671219121609, -3.326988923361867,
  -6.1605511345325183, -8.9941133457031679,
  -11.827675556873819, -14.661237768044463,
  -17.494799979215117, -20.328362190385768,
  15.830265277241789, 13.505325195787902,
  11.180385114334014, 8.8554450328801249,
  6.530504951426237, 4.2055648699723474,
  1.8806247885184604, -0.44431529293542882,
  -2.769255374389318, -5.0941954558432077,
  -7.4191355372970973, -9.7440756187509852,
  -12.06901570020487, -14.393955781658761,
  -16.71889586311265, 12.319021788480255,
  10.502703836743125, 8.686385885005997,
  6.8700679332688708, 5.0537499815317419,
  3.2374320297946131, 1.4211140780574869,
  -0.39520387367964149, -2.2115218254167699,
  -4.0278397771538987, -5.8441577288910267,
  -7.6604756806281555, -9.4767936323652791,
  -11.293111584102407, -13.109429535839537,
  8.8077782997187128, 7.5000824776983448,
  6.1923866556779794, 4.8846908336576123,
  3.576995011637246, 2.2692991896168784,
  0.96160336759651299, -0.34609245442385422,
  -1.6537882764442213, -2.9614840984645885,
  -4.2691799204849552, -5.5768757425053233,
  -6.8845715645256869, -8.1922673865460549,
  -9.4999632085664221, 5.2965348109571719,
  4.4974611186535665, 3.698387426349961,
  2.8993137340463555, 2.10024004174275,
  1.3011663494391439, 0.50209265713553897,
  -0.29698103516806684, -1.0960547274716728,
  -1.8951284197752787, -2.6942021120788846,
  -3.4932758043824901, -4.2923494966860947,
  -5.0914231889897001, -5.8904968812933065,
  1.7852913221956339, 1.4948397596087892,
  1.2043881970219446, 0.91393663443509965,
  0.62348507184825497, 0.33303350926140995,
  0.042581946674565427, -0.24786961591227955,
  -0.53832117849912442, -0.82877274108596932,
  -1.1192243036728142, -1.4096758662596596,
  -1.7001274288465036, -1.9905789914333485,
  -2.2810305540201941, -1.7259521665659086,
  -1.5077815994359915, -1.2896110323060748,
  -1.0714404651761587, -0.85326989804624176,
  -0.63509933091632531, -0.41692876378640886,
  -0.19875819665649219, 0.019412370473424499,
  0.23758293760334109, 0.45575350473325782,
  0.67392407186317449, 0.89209463899309083,
  1.1102652061230074, 1.3284357732529242,
  -5.2371956553274472, -4.5104029584807686,
  -3.7836102616340908, -3.0568175647874147,
  -2.3300248679407369, -1.6032321710940594,
  -0.87643947424738244, -0.14964677740070487,
  0.57714591944597271, 1.3039386162926503,
  2.0307313131393281, 2.7575240099860054,
  3.4843167068326815, 4.2111094036793588,
  4.9379021005260375, -8.7484391440889855,
  -7.513024317525546, -6.2776094909621074,
  -5.0421946643986697, -3.806779837835232,
  -2.5713650112717934, -1.3359501847083559,
  -0.10053535814491757, 1.1348794684185211,
  2.3702942949819596, 3.6057091215453982,
  4.8411239481088364, 6.0765387746722723,
  7.3119536012357109, 8.5473684277991513,
  -12.259682632850527, -10.515645676570326,
  -8.7716087202901267, -7.0275717640099282,
  -5.2835348077297279, -3.5394978514495286,
  -1.7954608951693301, -0.051423938889130209,
  1.6926130173910698, 3.4366499736712703,
  5.1806869299514702, 6.9247238862316705,
  8.6687608425118672, 10.412797798792067,
  12.156834755072268, -15.770926121612071,
  -13.518267035615109, -11.265607949618145,
  -9.0129488636211885, -6.7602897776242257,
  -4.5076306916272637, -2.2549716056303044,
  -0.0023125196333428385, 2.2503465663636186,
  4.5030056523605806, 6.7556647383575426,
  9.0083238243545036, 11.26098291035146,
  13.513641996348422, 15.766301082345386,
  -19.282169610373604, -16.520888394659881,
  -13.759607178946158, -10.998325963232441,
  -8.2370447475187181, -5.4757635318049962,
  -2.7144823160912774, 0.046798899622444462,
  2.8080801153361663, 5.5693613310498886,
  8.3306425467636114, 11.091923762477332,
  13.85320497819105, 16.614486193904771,
  19.375767409618494, -22.793413099135147,
  -19.523509753704662, -16.25360640827418,
  -12.983703062843698, -9.7137997174132149,
  -6.4438963719827314, -3.1739930265522518,
  0.095910318878231732, 3.3658136643087153,
  6.6357170097391993, 9.9056203551696829,
  13.175523700600166, 16.445427046030641,
  19.715330391461126, 22.985233736891612,
  -26.304656587896684, -22.526131112749439,
  -18.747605637602195, -14.969080162454954,
  -11.19055468730771, -7.4120292121604656,
  -3.6335037370132253, 0.14502173813401897,
  3.9235472132812634, 7.7020726884285082,
  11.480598163575753, 15.259123638722997,
  19.037649113870234, 22.816174589017479,
  26.594700064164726,
];

/** `fitted(m2)` at rows 1, 2, 50, 100, 200. */
const M2_FITTED_ROWS: readonly [number, number][] = [
  [1, -1.5708895891669803],
  [2, -0.43267738523315713],
  [50, -0.92843298592677248],
  [100, -1.8011895237719668],
  [200, 1.0667209673572653],
];

/** `fitted(m3)` at rows 1, 2, 50, 100, 200. */
const M3_FITTED_ROWS: readonly [number, number][] = [
  [1, -9.3125516279148464],
  [2, -1.0122867640124298],
  [50, -2.2010117574013761],
  [100, -4.0533116865482226],
  [200, 1.0737888571902563],
];

/** `predict(m2, grid)` at grid rows 1, 2, 15, 16, 113, 225. */
const M2_PREDICTION_ROWS: readonly [number, number][] = [
  [1, -6.9364765558496213],
  [2, -6.5230076527522929],
  [15, -1.1479119124870263],
  [16, -6.4462401948419528],
  [113, -0.61053970711464289],
  [225, 5.7153971416203353],
];

/** `predict(m3, grid3)` at grid rows 1, 2, 15, 16, 113, 225. */
const M3_PREDICTION_ROWS: readonly [number, number][] = [
  [1, 22.853142894599021],
  [2, 19.510892592211469],
  [15, -23.938361338826713],
  [16, 19.342016598836732],
  [113, -0.19872069975297871],
  [225, 26.592960891288858],
];

/** `mean(moderation_data$w)`, the hold value of the M3 control. */
const HOLD_W = -0.25603872504820924;

/** `range(moderation_data$y)`. */
const DATA_Y_RANGE: readonly [number, number] = [
  -14.110628278307653, 18.102464141094789,
];

const M1_ZLIM: readonly [number, number] = [
  -26.304656587896684, 26.594700064164726,
];

const M3_ZLIM: readonly [number, number] = [
  -26.302625246073081, 26.592960891288858,
];

/** The three models of the fixture document. */
const M1 = { outcome: "y", iv: "x", mod: "z" } as const;
const M2 = { outcome: "y", iv: "x", mod: "z", interaction: false } as const;
const M3 = { outcome: "y", iv: "x", mod: "z", controls: ["w"] } as const;

/**
 * The small frame of the rank-deficient fixture: `dup` repeats `x`, so R
 * aliases its coefficient to NA and still predicts over the grid.
 */
const ALIASED_FRAME: DataFrame = {
  y: [3, 5, 4, 8, 10, 9],
  x: [1, 2, 3, 4, 5, 6],
  z: [2, 1, 4, 3, 6, 5],
  dup: [1, 2, 3, 4, 5, 6],
};

function coefficientValues(
  surface: ReturnType<typeof moderationSurface>,
): readonly (number | null)[] {
  return surface.coefficients.map((term) => term.value);
}

function coefficientNames(
  surface: ReturnType<typeof moderationSurface>,
): readonly string[] {
  return surface.coefficients.map((term) => term.name);
}

describe("moderationSurface: the prediction grid", () => {
  const surface = moderationSurface(moderationData, M1);

  test("steps the IV 15 times, matching R's seq bit for bit", () => {
    expect(surface.ivValues).toHaveLength(15);
    SEQ_X.forEach((expected, index) => {
      expect(surface.ivValues[index]).toBe(expected);
    });
  });

  test("steps the moderator 15 times, matching R's seq bit for bit", () => {
    expect(surface.modValues).toHaveLength(15);
    SEQ_Z.forEach((expected, index) => {
      expect(surface.modValues[index]).toBe(expected);
    });
  });

  test("starts and ends each axis on the data's own minimum and maximum", () => {
    expect(surface.ivValues[0]).toBe(Math.min(...moderationData.x));
    expect(surface.ivValues[14]).toBe(Math.max(...moderationData.x));
    expect(surface.modValues[0]).toBe(Math.min(...moderationData.z));
    expect(surface.modValues[14]).toBe(Math.max(...moderationData.z));
  });

  test("predicts one value per grid point", () => {
    expect(surface.predictions).toHaveLength(225);
  });

  test("varies the IV fastest, as R's expand.grid does", () => {
    // Without this the loop below runs over nothing and asserts nothing.
    expect(surface.predictions).toHaveLength(225);
    // Rebuild each prediction from the coefficients. The row order is the
    // only unknown, so an agreement across all 225 rows pins it.
    const [intercept, byIv, byMod, byProduct] = coefficientValues(
      surface,
    ) as readonly number[];

    surface.predictions.forEach((prediction, index) => {
      const iv = surface.ivValues[index % 15] as number;
      const mod = surface.modValues[Math.floor(index / 15)] as number;
      const expected =
        (intercept as number) +
        (byIv as number) * iv +
        (byMod as number) * mod +
        (byProduct as number) * iv * mod;
      expectCloseToR(prediction, expected);
    });
  });
});

describe("moderationSurface: M1, y ~ x * z", () => {
  const surface = moderationSurface(moderationData, M1);

  test("names the terms in R's model.matrix order", () => {
    expect(coefficientNames(surface)).toEqual(["(Intercept)", "x", "z", "x:z"]);
  });

  test("reproduces R's coefficients", () => {
    M1_COEFFICIENTS.forEach((expected, index) => {
      expectCloseToR(surface.coefficients[index]?.value as number, expected);
    });
  });

  test("reproduces all 200 fitted values", () => {
    expect(surface.fitted).toHaveLength(200);
    M1_FITTED.forEach((expected, index) => {
      expectCloseToR(surface.fitted[index] as number, expected);
    });
  });

  test("reports R's residuals, which are the factorization's and not y minus the fit", () => {
    // `lm.fit` returns the residuals `dqrsl` computes and takes the fitted
    // values as `y` minus them, so the two do not satisfy
    // `residuals == y - fitted` in the last bit. R's own disagree on 93 of
    // the 200 rows, by at most 1.3e-15 — see linalg fixture 4h, which the
    // first five values below come from.
    expect(surface.residuals).toHaveLength(200);
    expect(surface.fitted.slice(0, 5)).toEqual([
      -9.3130443937296636, -1.0085002297724963, 2.4752805151804269,
      6.2660758865938044, -2.4157444554560819,
    ]);
    expect(surface.residuals.slice(0, 5)).toEqual([
      2.0401471936584668, -0.82835018078112699, 0.007222511740669642,
      -0.17752563937798069, -0.36564880316550952,
    ]);
    surface.residuals.forEach((residual, index) => {
      expectCloseToR(
        residual,
        (moderationData.y[index] as number) - (surface.fitted[index] as number),
      );
    });
  });

  test("reproduces all 225 grid predictions", () => {
    M1_PREDICTIONS.forEach((expected, index) => {
      expectCloseToR(surface.predictions[index] as number, expected);
    });
  });

  test("takes both ends of zlim from the surface, which swings past the data", () => {
    expectCloseToR(surface.zlim[0], M1_ZLIM[0]);
    expectCloseToR(surface.zlim[1], M1_ZLIM[1]);
    expect(surface.zlim[0]).toBeLessThan(DATA_Y_RANGE[0]);
    expect(surface.zlim[1]).toBeGreaterThan(DATA_Y_RANGE[1]);
  });

  test("holds nothing: the model has no other predictor", () => {
    expect(surface.holds).toEqual({});
    // Contrast: a model that does have another predictor holds it.
    expect(Object.keys(moderationSurface(moderationData, M3).holds)).toEqual([
      "w",
    ]);
  });
});

describe("moderationSurface: M2, y ~ x + z", () => {
  const surface = moderationSurface(moderationData, M2);

  test("drops the interaction term when interaction is false", () => {
    expect(coefficientNames(surface)).toEqual(["(Intercept)", "x", "z"]);
  });

  test("reproduces R's coefficients", () => {
    M2_COEFFICIENTS.forEach((expected, index) => {
      expectCloseToR(surface.coefficients[index]?.value as number, expected);
    });
  });

  test("reproduces the sampled fitted values", () => {
    M2_FITTED_ROWS.forEach(([row, expected]) => {
      expectCloseToR(surface.fitted[row - 1] as number, expected);
    });
  });

  test("reproduces the sampled grid predictions", () => {
    M2_PREDICTION_ROWS.forEach(([row, expected]) => {
      expectCloseToR(surface.predictions[row - 1] as number, expected);
    });
  });

  test("takes both ends of zlim from the data, which the flat surface never reaches", () => {
    // The additive surface has no twist, so it stays inside the observed y.
    expect(surface.zlim[0]).toBe(DATA_Y_RANGE[0]);
    expect(surface.zlim[1]).toBe(DATA_Y_RANGE[1]);
    expect(Math.min(...surface.predictions)).toBeGreaterThan(DATA_Y_RANGE[0]);
    expect(Math.max(...surface.predictions)).toBeLessThan(DATA_Y_RANGE[1]);
  });

  test("still steps the same grid as M1", () => {
    SEQ_X.forEach((expected, index) => {
      expect(surface.ivValues[index]).toBe(expected);
    });
  });
});

describe("moderationSurface: M3, y ~ x + z + w + x:z", () => {
  const surface = moderationSurface(moderationData, M3);

  test("puts controls before the interaction, as R's model.matrix does", () => {
    expect(coefficientNames(surface)).toEqual([
      "(Intercept)",
      "x",
      "z",
      "w",
      "x:z",
    ]);
  });

  test("reproduces R's coefficients", () => {
    M3_COEFFICIENTS.forEach((expected, index) => {
      expectCloseToR(surface.coefficients[index]?.value as number, expected);
    });
  });

  test("reproduces the sampled fitted values", () => {
    M3_FITTED_ROWS.forEach(([row, expected]) => {
      expectCloseToR(surface.fitted[row - 1] as number, expected);
    });
  });

  test("holds the control at its mean, R's hold_value() for a numeric column", () => {
    expect(Object.keys(surface.holds)).toEqual(["w"]);
    expectCloseToR(surface.holds.w as number, HOLD_W);
  });

  test("predicts the grid with the control at that hold value", () => {
    M3_PREDICTION_ROWS.forEach(([row, expected]) => {
      expectCloseToR(surface.predictions[row - 1] as number, expected);
    });
  });

  test("takes both ends of zlim from the surface", () => {
    expectCloseToR(surface.zlim[0], M3_ZLIM[0]);
    expectCloseToR(surface.zlim[1], M3_ZLIM[1]);
  });
});

describe("moderationSurface: rank-deficient and degenerate frames", () => {
  test("reports an aliased coefficient as null, as R reports NA", () => {
    const surface = moderationSurface(ALIASED_FRAME, {
      outcome: "y",
      iv: "x",
      mod: "z",
      controls: ["dup"],
    });

    expect(coefficientNames(surface)).toEqual([
      "(Intercept)",
      "x",
      "z",
      "dup",
      "x:z",
    ]);
    expect(coefficientValues(surface)[3]).toBeNull();
    expectCloseToR(
      coefficientValues(surface)[0] as number,
      3.5312500000000027,
    );
    expectCloseToR(coefficientValues(surface)[1] as number, 0.86458333333333215);
    expectCloseToR(
      coefficientValues(surface)[2] as number,
      -0.80208333333333315,
    );
    expectCloseToR(
      coefficientValues(surface)[4] as number,
      0.18750000000000011,
    );
  });

  test("predicts through an aliased term, dropping it as R's predict does", () => {
    const surface = moderationSurface(ALIASED_FRAME, {
      outcome: "y",
      iv: "x",
      mod: "z",
      controls: ["dup"],
    });

    expectCloseToR(surface.predictions[0] as number, 3.7812500000000018);
    expectCloseToR(surface.predictions[112] as number, 6.0468750000000009);
    expectCloseToR(surface.predictions[224] as number, 10.656250000000002);
    expectCloseToR(surface.zlim[0], 0.70833333333333659);
    expectCloseToR(surface.zlim[1], 10.656250000000002);
    expect(surface.holds.dup).toBe(3.5);
  });

  test("repeats a constant axis 15 times, as R's seq(3, 3, length.out = 15) does", () => {
    const surface = moderationSurface(
      {
        y: [1, 2, 3, 4],
        x: [3, 3, 3, 3],
        z: [1, 2, 3, 4],
      },
      { outcome: "y", iv: "x", mod: "z" },
    );

    expect(surface.ivValues).toEqual(new Array(15).fill(3));
  });
});

describe("moderationSurface: refusals", () => {
  const data = moderationData;

  test("refuses an outcome that is not a column", () => {
    expect(() =>
      moderationSurface(data, { outcome: "nope", iv: "x", mod: "z" }),
    ).toThrow(RangeError);
  });

  test("refuses an IV that is not a column", () => {
    expect(() =>
      moderationSurface(data, { outcome: "y", iv: "nope", mod: "z" }),
    ).toThrow(/nope/);
  });

  test("refuses a moderator that is not a column", () => {
    expect(() =>
      moderationSurface(data, { outcome: "y", iv: "x", mod: "nope" }),
    ).toThrow(/nope/);
  });

  test("refuses a control that is not a column", () => {
    expect(() =>
      moderationSurface(data, {
        outcome: "y",
        iv: "x",
        mod: "z",
        controls: ["nope"],
      }),
    ).toThrow(/nope/);
  });

  test("refuses an IV and a moderator that name the same column", () => {
    expect(() =>
      moderationSurface(data, { outcome: "y", iv: "x", mod: "x" }),
    ).toThrow(RangeError);
  });

  test("refuses a non-numeric outcome", () => {
    const frame: DataFrame = { label: ["a", "b"], x: [1, 2], z: [3, 4] };
    expect(() =>
      moderationSurface(frame, { outcome: "label", iv: "x", mod: "z" }),
    ).toThrow(/label/);
  });

  test("refuses a non-numeric axis, as R does for a factor", () => {
    const frame: DataFrame = { y: [1, 2], label: ["a", "b"], z: [3, 4] };
    expect(() =>
      moderationSurface(frame, { outcome: "y", iv: "label", mod: "z" }),
    ).toThrow(/label/);
  });

  test("refuses a non-numeric control, a documented departure from R", () => {
    const frame: DataFrame = {
      y: [1, 2],
      x: [1, 2],
      z: [3, 4],
      label: ["a", "b"],
    };
    expect(() =>
      moderationSurface(frame, {
        outcome: "y",
        iv: "x",
        mod: "z",
        controls: ["label"],
      }),
    ).toThrow(/label/);
  });

  test("refuses a control that repeats the IV, the moderator, or the outcome", () => {
    (["x", "z", "y"] as const).forEach((name) => {
      expect(() =>
        moderationSurface(data, {
          outcome: "y",
          iv: "x",
          mod: "z",
          controls: [name],
        }),
      ).toThrow(RangeError);
    });
  });

  test("refuses the same control twice, which would alias a column", () => {
    expect(() =>
      moderationSurface(data, {
        outcome: "y",
        iv: "x",
        mod: "z",
        controls: ["w", "w"],
      }),
    ).toThrow(RangeError);
  });

  test("refuses a frame whose columns have different lengths", () => {
    expect(() =>
      moderationSurface(
        { y: [1, 2, 3], x: [1, 2], z: [1, 2, 3] },
        { outcome: "y", iv: "x", mod: "z" },
      ),
    ).toThrow(RangeError);
  });

  test("refuses a frame with no rows", () => {
    expect(() =>
      moderationSurface(
        { y: [], x: [], z: [] },
        { outcome: "y", iv: "x", mod: "z" },
      ),
    ).toThrow(RangeError);
  });
});

describe("moderationSurface: missing values, R's na.omit", () => {
  /**
   * The app layer above this library imports CSVs the way R's `read.csv`
   * does: a missing numeric cell becomes NaN. `lm()` drops such rows before
   * fitting (`na.action = na.omit`), and `hold_value()` takes its mean with
   * `na.rm = TRUE` — so `plot_moderation_3d()` fits real-world data with
   * holes in it. The port must do the same, not fit through NaN.
   *
   * Fixture from R 4.5.3, printed with `sprintf("%.17g", x)`:
   *
   * ```r
   * d <- data.frame(
   *   y = c(3, 5, NA, 8, 10, 9),
   *   x = c(1, 2, 3, 4, 5, 6),
   *   z = c(2, 1, 4, 3, 6, 5),
   *   w = c(10, 20, 30, NA, 50, 40)
   * )
   * m <- lm(y ~ x * z, data = d)             # na.omit drops row 3
   * coef(m); fitted(m); residuals(m)
   * seq_x <- seq(min(d$x), max(d$x), length.out = 15)
   * seq_z <- seq(min(d$z), max(d$z), length.out = 15)
   * grid <- setNames(expand.grid(seq_x, seq_z), c("x", "z"))
   * pred <- predict(m, grid)
   * range(c(d$y[!is.na(d$y)], pred))          # zlim over finite outcomes
   * mean(d$w, na.rm = TRUE)                   # hold_value()
   * ```
   *
   * One departure, stated: R computes zlim as `range(c(data[[dv]],
   * grid[[dv]]))` with no `na.rm`, so a missing outcome makes R's zlim NA
   * and the wireframe fails. The port takes the range over the finite
   * outcomes instead, because a caller who was allowed to fit must also be
   * allowed to draw.
   */
  const data: DataFrame = {
    y: [3, 5, NaN, 8, 10, 9],
    x: [1, 2, 3, 4, 5, 6],
    z: [2, 1, 4, 3, 6, 5],
    w: [10, 20, 30, NaN, 50, 40],
  };
  const MODEL = { outcome: "y", iv: "x", mod: "z" } as const;

  const NA_COEFFICIENTS = [
    -0.18750000000000019, 1.8124999999999996, 1.3125000000000011,
    -0.25000000000000006,
  ];
  /** `fitted(m)`, named by the surviving rows 1, 2, 4, 5, 6. */
  const NA_FITTED = [3.75, 4.25, 8, 9.25, 9.75];
  /** `pred[c(1, 2, 113, 225)]`, 1-based. */
  const NA_PREDICTIONS: readonly (readonly [number, number])[] = [
    [0, 2.6875000000000004],
    [1, 3.2455357142857144],
    [112, 7.6875000000000009],
    [224, 9.5625000000000018],
  ];
  const NA_ZLIM = [2.6875000000000004, 10.499999999999998];

  test("drops a row whose outcome is missing before fitting, as R's lm does", () => {
    const surface = moderationSurface(data, MODEL);

    NA_COEFFICIENTS.forEach((expected, index) => {
      expectCloseToR(surface.coefficients[index]?.value as number, expected);
    });
  });

  test("keeps fitted and residuals in input order, NaN where a row was dropped", () => {
    const surface = moderationSurface(data, MODEL);

    expect(surface.fitted).toHaveLength(6);
    expect(surface.fitted[2]).toBeNaN();
    expect(surface.residuals[2]).toBeNaN();
    [0, 1, 3, 4, 5].forEach((row, survivor) => {
      expectCloseToR(surface.fitted[row] as number, NA_FITTED[survivor] as number);
    });
    expectCloseToR(surface.residuals[0] as number, -0.74999999999999989);
  });

  test("predicts a finite surface past the missing row", () => {
    const surface = moderationSurface(data, MODEL);

    expect(surface.predictions.every(Number.isFinite)).toBe(true);
    NA_PREDICTIONS.forEach(([index, expected]) => {
      expectCloseToR(surface.predictions[index] as number, expected);
    });
  });

  test("takes zlim over the finite outcomes, a stated departure from R", () => {
    const surface = moderationSurface(data, MODEL);

    expectCloseToR(surface.zlim[0], NA_ZLIM[0] as number);
    expectCloseToR(surface.zlim[1], NA_ZLIM[1] as number);
  });

  test("holds a control at its finite mean, R's hold_value(na.rm = TRUE)", () => {
    const surface = moderationSurface(data, {
      ...MODEL,
      controls: ["w"],
    });

    expectCloseToR(surface.holds["w"] as number, 30);
  });

  test("refuses a model with no complete rows", () => {
    expect(() =>
      moderationSurface(
        { y: [NaN, NaN], x: [1, 2], z: [2, 1] },
        { outcome: "y", iv: "x", mod: "z" },
      ),
    ).toThrow(/complete/);
  });
});
