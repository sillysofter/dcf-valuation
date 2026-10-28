# DCF Valuation Model

A discounted cash flow (DCF) model built the way investment banks build one. You enter the assumptions in a YAML file. The model projects unlevered free cash flow, builds WACC from CAPM, values the business with both the **perpetuity growth** and **exit multiple** methods, bridges enterprise value to equity value, and solves the **treasury stock method** for diluted shares. It produces **sensitivity tables** and exports a **formula-driven Excel model**: change any blue input in Excel and the share price updates.

It also runs as a **website** ([web/](web/)): an interactive version you can host free on Cloudflare Pages. It recalculates as you type, draws charts, and lets you share any scenario as a link.

The included example is a **fictional** mid-cap industrial company with made-up numbers ([configs/example.yaml](configs/example.yaml)).

**Live demo:** `https://<your-project>.pages.dev` *(replace once deployed)*

## Features

- **Unlevered FCF build**: revenue growth, EBITDA margin, D&A, CapEx and net working capital as % of revenue, set year by year
- **WACC**: CAPM cost of equity with an optional size premium, Hamada beta relevering at a target capital structure, after-tax cost of debt
- **Two terminal value methods** with cross-checks: the multiple implied by the perpetuity method, and the growth rate implied by the exit multiple
- **Mid-year convention** (on or off), with the terminal value discounted correctly for each method (see [Methodology](#methodology))
- **Full equity bridge**: debt, preferred equity, minority interest, cash, non-operating assets
- **Treasury stock method** for multiple option tranches plus RSUs, solved exactly with no circular reference or iteration
- **Sensitivity tables**: WACC × terminal growth and WACC × exit multiple
- **Excel export** in the banking colour convention (blue inputs, black formulas, green links), with Inputs, WACC, DCF and Sensitivity sheets
- **Tested**: hand-calculated checks, closed-form identities, a bisection cross-check of the TSM solver, and a LibreOffice recalculation that checks every key Excel cell against Python

## Installation

```bash
git clone https://github.com/<your-username>/dcf-valuation.git
cd dcf-valuation
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## Usage

```bash
dcfmodel configs/example.yaml                                  # print the valuation
dcfmodel configs/example.yaml --excel results/model.xlsx       # plus the Excel model
dcfmodel configs/example.yaml --json results/summary.json      # plus machine-readable output
dcfmodel configs/example.yaml --wacc-step 0.0025 --multiple-step 0.5   # finer sensitivity grids
```

`python -m dcfmodel` works too. To value a real company, copy `configs/example.yaml` and replace the inputs with figures from its 10-K, consensus estimates and market data. The comments in the file explain each input.

### Example output

From [examples/meridian_report.txt](examples/meridian_report.txt). The Excel version is [examples/meridian_dcf.xlsx](examples/meridian_dcf.xlsx).

```
  Fiscal year                   FY2026E    FY2027E    FY2028E    FY2029E    FY2030E
  Revenue                       2,592.0    2,786.4    2,967.5    3,130.7    3,271.6
  EBITDA                          544.3      599.1      652.9      704.4      752.5
  Unlevered FCF                   282.9      325.0      366.4      408.1      449.0
  PV of UFCF                      270.2      283.2      291.3      295.9      297.0

  WACC                           9.61%

                                        Perpetuity   Exit multiple
  Assumption                             g = 2.50%    10.0x EBITDA
  Enterprise value                         5,717.6         6,192.8
  PV of TV, % of EV                          74.9%           76.8%
  Implied multiple / growth                   9.0x           3.17%
  Equity value                             5,087.6         5,562.8
  Diluted shares                           122.777         123.127
  Implied share price                        41.44           45.18
  Upside vs 38.50                             7.6%           17.3%
```

### Using it as a library

```python
from dcfmodel import load_assumptions, run_dcf, wacc_vs_growth

a = load_assumptions("configs/example.yaml")
result = run_dcf(a)
print(result.wacc, result.perpetuity.share_price, result.exit.share_price)

# Override any of WACC, terminal growth or exit multiple
print(run_dcf(a, wacc=0.09, terminal_growth=0.02).perpetuity.enterprise_value)
table = wacc_vs_growth(a, waccs=[0.085, 0.095, 0.105], growths=[0.02, 0.025, 0.03])
```

## Website

[web/](web/) is a static site with no build step and no dependencies. It is plain HTML, CSS and JavaScript, and everything runs in the browser.

- Every input is editable, including the number of projection years (1–15) and the option tranches. Results update immediately.
- Headline share prices, a valuation-range (football field) chart, a UFCF chart, the full FCF build, the EV-to-equity bridge, the WACC build and shaded sensitivity grids
- **Copy share link**: the whole scenario is encoded in the URL, so a link reopens exactly what you were looking at
- **Download**: inputs as YAML (runs directly with the CLI, e.g. for the Excel model), projections as CSV, and full results as JSON
- Light and dark mode, and phone-width layout

[web/dcf.js](web/dcf.js) is a line-for-line port of the Python engine. `tests/test_web_engine.py` runs it in an embedded V8 and checks every output against Python to 12 significant digits across six scenarios, plus validation errors, the TSM solver and the YAML export. The website therefore cannot silently disagree with the CLI or the Excel model.

Run it locally:

```bash
python -m http.server 8000 --directory web    # then open http://localhost:8000
```

### Deploying to Cloudflare Pages

1. Push this repository to GitHub.
2. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages → Connect to Git**, and pick the repository.
3. Build settings: framework preset **None**, build command **empty**, build output directory **`web`**. ([wrangler.toml](wrangler.toml) sets the same output directory.)
4. Click **Save and Deploy**. Every push to `main` redeploys, and pull requests get preview URLs.

Or deploy from your machine without Git: `npx wrangler pages deploy web`.

[web/_headers](web/_headers) sets a strict Content Security Policy (no inline or third-party scripts) and other security headers. Cloudflare Pages applies it automatically.

## Methodology

The valuation date is the end of the base fiscal year. Projection years are $t = 1, \dots, N$.

**Unlevered free cash flow**

$$\text{UFCF}_t = \text{EBIT}_t - \text{Taxes}_t + \text{D\&A}_t - \text{CapEx}_t - \Delta\text{NWC}_t$$

with $\text{EBIT} = \text{EBITDA} - \text{D\&A}$, $\text{Taxes} = t_c \cdot \max(\text{EBIT}, 0)$ and $\Delta\text{NWC}_t = \text{NWC}_t - \text{NWC}_{t-1}$. The base-year NWC is an input.

**Discount rate**

$$\beta_L = \beta_U\left(1 + (1 - t_c)\tfrac{D}{E}\right), \qquad r_e = r_f + \beta_L \cdot \text{ERP} + \text{size premium}$$

$$\text{WACC} = \tfrac{E}{D+E}\, r_e + \tfrac{D}{D+E}\, r_d (1 - t_c)$$

using the *target* capital structure, not the current one.

**Discounting.** With the mid-year convention, year-$t$ cash flow is discounted $t - 0.5$ years, because cash arrives through the year rather than at year end. Without it, the period is $t$.

**Terminal value**

- Perpetuity growth: $\text{TV} = \text{UFCF}_N (1 + g) / (\text{WACC} - g)$. Under the mid-year convention, the cash flows after year $N$ also arrive mid-year, so this value is discounted $N - 0.5$ years (otherwise $N$).
- Exit multiple: $\text{TV} = \text{EBITDA}_N \times \text{multiple}$. This is a sale price at the end of year $N$, so it is always discounted $N$ years.

Many spreadsheets discount both terminal values by $N$ under the mid-year convention. That understates the perpetuity value by a factor of $(1+\text{WACC})^{0.5}$. The tests check that a business growing at exactly $g$ from year 1 is valued at exactly $\text{UFCF}_1/(\text{WACC}-g)$, times $(1+\text{WACC})^{0.5}$ with mid-year discounting.

**Cross-checks.** The perpetuity TV, restated to the end of year $N$, divided by $\text{EBITDA}_N$ gives the implied exit multiple. Solving the perpetuity formula for $g$, given the exit-multiple TV, gives the implied perpetual growth rate. If the two methods disagree widely, the assumptions are inconsistent.

**Equity bridge**

$$\text{Equity} = \text{EV} - \text{Debt} - \text{Preferred} - \text{Minority interest} + \text{Cash} + \text{Non-operating assets}$$

**Treasury stock method.** Diluted shares depend on the share price, and the share price depends on diluted shares. The price $P$ solves $P \cdot D(P) = E$, with

$$D(P) = \text{basic} + \text{RSUs} + \sum_{K_i < P} n_i \left(1 - K_i/P\right)$$

$P \cdot D(P)$ is continuous and strictly increasing in $P$, so the solution is unique. If the $k$ lowest-strike tranches are in the money, then $P = (E + \sum n_i K_i)/(\text{basic} + \text{RSUs} + \sum n_i)$. The model tries $k = 0, 1, \dots$ and keeps the candidate that falls in $(K_k, K_{k+1}]$. The Excel sheet does the same thing in a small table, so the workbook has **no circular references** and needs no iterative calculation.

## The Excel model

| Sheet | Contents |
|---|---|
| Inputs | Base year, tax, terminal assumptions, balance sheet, shares, option tranches |
| WACC | Cost of equity, relevered beta, after-tax cost of debt, WACC |
| DCF | Year-by-year drivers (blue) and UFCF build, discounting, both terminal methods, equity bridge, TSM table, share price |
| Sensitivity | WACC × growth and WACC × multiple share-price grids, base case highlighted |

Inputs, WACC and DCF are entirely formulas. The Sensitivity sheet holds values computed in Python, because openpyxl cannot write Excel data tables, so rerun `dcfmodel` after changing assumptions to refresh it. Keep option tranches sorted by ascending strike if you edit them in Excel.

## Testing

```bash
pytest
```

The suite checks:

- WACC, the first projection year and the example share price against hand calculations
- accounting identities in every year, and zero tax on operating losses
- the steady-state perpetuity identity, with and without mid-year discounting
- that the two terminal methods agree exactly when the exit multiple equals the implied multiple
- the TSM solver against an independent bisection on 500 random cap tables, including tied strikes and negative equity
- input validation and the CLI end to end

`tests/test_web_engine.py` runs the website's JavaScript engine in V8 (`mini-racer`) and checks that it matches Python for every output.

`tests/test_excel.py` recalculates exported workbooks in headless LibreOffice for four scenarios: the example, end-of-year discounting with no options, tied strikes with all options in the money, and operating losses. It checks every key cell against Python to a relative tolerance of 1e-9. These tests are skipped if LibreOffice is not installed. GitHub Actions runs the suite on Python 3.10–3.12 and runs the Excel check in a separate job with LibreOffice installed.

## Assumptions and limitations

- **Valuation date = base fiscal year end.** There is no stub period for valuing partway through a year.
- **Taxes** are a flat rate on positive EBIT. There are no NOL carryforwards, deferred taxes or tax shield from leases.
- **Terminal year.** The perpetuity method grows the final projected UFCF. That assumes CapEx, D&A and NWC investment in year $N$ are already consistent with growth $g$. Project far enough that the business is in steady state.
- **Constant WACC** across all years, at a target capital structure.
- **Options**: the TSM uses all outstanding options, not just exercisable ones, and ignores unvested forfeiture. Convertible securities are not modelled. Treat convertibles as debt or as shares, whichever is more dilutive.
- The example company and all of its figures are fictional.

This project is for education and demonstration only. It is not investment advice.

## Project structure

```
src/dcfmodel/
├── assumptions.py  # inputs dataclass, YAML loader and validation
├── wacc.py         # CAPM, beta relevering, WACC
├── projections.py  # operating model and unlevered free cash flow
├── valuation.py    # discounting, terminal values, equity bridge
├── dilution.py     # treasury stock method
├── sensitivity.py  # two-way sensitivity tables
├── excel.py        # formula-driven Excel export
├── report.py       # text report and JSON output
└── cli.py          # command-line interface
web/                # static website for Cloudflare Pages
├── index.html
├── dcf.js          # JavaScript port of the engine (tested against Python)
├── app.js          # UI: inputs, charts, sharing, downloads
├── styles.css
└── _headers        # security headers for Cloudflare Pages
configs/            # example assumptions
examples/           # sample report, Excel model and JSON output
tests/              # pytest suite
```

## License

MIT. See [LICENSE](LICENSE).
