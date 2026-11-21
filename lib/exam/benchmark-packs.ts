import type { MocktestTitleItem } from '../types/catalog';
import type { ExamSet } from './types';

/**
 * Exact Pillar 2 Pan-India Multi-Pattern Benchmark + Multi-Section CBT Sets.
 * Used as a deterministic fallback ONLY when upstream Firebase Storage denies
 * unauthenticated sample reads (e.g. missing Storage download token) so free
 * sample previews and full CBT capabilities work seamlessly without schema drift.
 */
export const BENCHMARK_SET_1: ExamSet = {
  id: 'exam_set_1',
  title: 'Mock Set 01: Pan-India Multi-Pattern Benchmark',
  duration: 60,
  totalQuestions: 6,
  totalMarks: 13,
  sectionalTiming: true,
  calculator: 'scientific',
  sections: [
    {
      id: 'sec_1',
      title: 'Data Interpretation, Engineering Logic & Chemical Sciences',
      duration: 40,
      totalQuestions: 4,
      maxAttempts: null,
      contexts: [
        {
          id: 'sec_1_ctx_1',
          title: 'Base Caselet (Q1 – Q2): Cloud Infrastructure Telemetry',
          text: '**Directions:** Study the **three interconnected visuals** (Chart 1, Chart 2, and Table 1) carefully.',
          visuals: [
            {
              id: 'v1',
              type: 'chart',
              chartType: 'pie',
              title: 'Chart 1: Share of Total Cloud Server Traffic (Total = 8,000 TB)',
              note: '**Note:** Regional traffic consists solely of Web and API requests.',
              xAxisKey: 'region',
              series: [{ key: 'share', label: 'Traffic Share (%)' }],
              data: [
                { region: 'Region X', share: 35 },
                { region: 'Region Y', share: 45 },
                { region: 'Region Z', share: 20 },
              ],
            },
            {
              id: 'v2',
              type: 'chart',
              chartType: 'combo',
              title: "Chart 2: Base Cost per TB (₹ '000) & SLA Outage (Hours)",
              note: '**Formula:** $\\text{Total SLA Penalty} = \\text{Outage Hours} \\times ₹15,000$.',
              xAxisKey: 'region',
              yAxisLabel: "Cost/TB (₹ '000)",
              rightYAxisLabel: 'Outage (Hrs)',
              series: [
                {
                  key: 'cost',
                  label: "Cost/TB (₹ '000)",
                  type: 'bar',
                  yAxis: 'left',
                },
                {
                  key: 'outage',
                  label: 'Outage (Hrs)',
                  type: 'line',
                  yAxis: 'right',
                },
              ],
              data: [
                { region: 'Region X', cost: 12, outage: 4 },
                { region: 'Region Y', cost: 10, outage: 6 },
                { region: 'Region Z', cost: 15, outage: 2 },
              ],
            },
            {
              id: 'v3',
              type: 'table',
              title: 'Table 1: Traffic Split & Enterprise Discount',
              note: 'Discount applies on gross traffic cost prior to adding SLA penalty.',
              headers: [
                [
                  { text: 'Region', rowSpan: 2 },
                  { text: 'Billing Parameters', colSpan: 2, align: 'center' },
                ],
                ['Web : API Ratio', 'Discount on Gross Cost'],
              ],
              rows: [
                ['Region X', '$4 : 3$', '$10\\%$'],
                ['Region Y', '$5 : 4$', '$20\\%$'],
                ['Region Z', '$3 : 2$', '$15\\%$'],
              ],
            },
          ],
        },
        {
          id: 'sec_1_ctx_2',
          title: 'Supplementary Scenario (Applicable to Q2 Only)',
          text: 'In **Q2 FY27**, tariff revision increases Base Cost/TB in __Region Y__ by $25\\%$, while automated failover cuts its SLA outage to $0\\text{ hours}$.',
          visuals: [],
        },
      ],
      questions: [
        {
          id: 'sec_1_q_1',
          contextIds: ['sec_1_ctx_1'],
          type: 'NAT',
          marks: { correct: 3, wrong: 0, partial: 0 },
          prompt:
            "Find the net amount payable (in ₹ Lakh) for **API Traffic** in **Region X** after applying its discount and adding $50\\%$ of Region X's total SLA penalty.",
          visuals: [],
          options: [],
          answer: [129.9, 129.9],
          explanation:
            '1. **Region X Traffic:** $35\\% \\text{ of } 8000 = 2800\\text{ TB}$.\n2. **API Traffic:** $\\frac{3}{4+3} \\times 2800 = 1200\\text{ TB}$.\n3. **Gross Cost:** $1200 \\times ₹12,000 = ₹144\\text{ Lakh}$.\n4. **After 10% Discount:** $144 \\times 0.90 = ₹129.6\\text{ Lakh}$.\n5. **50% SLA Penalty:** $0.5 \\times (4 \\times ₹15,000) = ₹0.3\\text{ Lakh}$.\n6. **Net Payable:** $129.6 + 0.3 = ₹129.9\\text{ Lakh}$.',
          explanationVisuals: [],
        },
        {
          id: 'sec_1_q_2',
          contextIds: ['sec_1_ctx_1', 'sec_1_ctx_2'],
          type: 'MCQ',
          marks: { correct: 2, wrong: -0.5, partial: 0 },
          prompt:
            'Under the **Q2 FY27** scenario, what is the net amount payable (in ₹ Lakh) for __Web Traffic__ in **Region Y** after applying its standard discount?',
          visuals: [],
          options: [
            { id: 'A', text: '$₹180\\text{ Lakh}$', visuals: [] },
            { id: 'B', text: '$₹192\\text{ Lakh}$', visuals: [] },
            { id: 'C', text: '$₹200\\text{ Lakh}$', visuals: [] },
            { id: 'D', text: '$₹225\\text{ Lakh}$', visuals: [] },
            { id: 'E', text: 'None of these', visuals: [] },
          ],
          answer: 'C',
          explanation:
            'Web Traffic in Region Y $= \\frac{5}{9} \\times (45\\% \\text{ of } 8000) = 2000\\text{ TB}$. Revised Cost/TB $= ₹10,000 \\times 1.25 = ₹12,500$. Gross $= ₹250\\text{ Lakh}$. After $20\\%$ discount and $₹0$ SLA penalty, Net Payable $= ₹200\\text{ Lakh}$.',
          explanationVisuals: [],
        },
        {
          id: 'sec_1_q_3',
          contextIds: [],
          type: 'MCQ',
          marks: { correct: 2, wrong: -0.666667, partial: 0 },
          prompt:
            'A C routine computes control bits `A` and `B`:\n```c\nint x = 2, *p = &x;\nint A = (*p >> 1) & 1;\nint B = (*p) & 1;\n```\nThese drive the combinational circuit {{v1}} and controller FSM {{v2}}. Starting in $S_0$, find output $Y$ and the next state.',
          visuals: [
            {
              id: 'v1',
              type: 'svg',
              title: 'Figure 1: Combinational Front-End',
              note: 'Ideal AND gate.',
              data: "<svg viewBox='0 0 320 120' xmlns='http://www.w3.org/2000/svg'><line x1='20' y1='40' x2='90' y2='40' stroke='#0f172a' stroke-width='2'/><text x='10' y='44' font-size='12'>A</text><line x1='20' y1='80' x2='90' y2='80' stroke='#0f172a' stroke-width='2'/><text x='10' y='84' font-size='12'>B</text><path d='M90,25 L130,25 A35,35 0 0,1 130,95 L90,95 Z' fill='#e0f2fe' stroke='#0284c7' stroke-width='2'/><text x='104' y='65' font-size='12'>AND</text><line x1='165' y1='60' x2='240' y2='60' stroke='#0f172a' stroke-width='2'/><text x='246' y='64' font-size='12'>Y = A·B</text></svg>",
            },
            {
              id: 'v2',
              type: 'mermaid',
              title: 'Figure 2: Downstream Controller FSM',
              note: 'Transitions occur on rising clock edge.',
              data: 'stateDiagram-v2\n direction LR\n S0 --> S1 : Y = 1\n S0 --> S0 : Y = 0',
            },
          ],
          options: [
            { id: 'A', text: '$Y = 0$, Controller stays in $S_0$', visuals: [] },
            { id: 'B', text: '$Y = 1$, Controller moves to $S_1$', visuals: [] },
            { id: 'C', text: '$Y = 1$, Controller stays in $S_0$', visuals: [] },
            { id: 'D', text: '$Y = 0$, Controller moves to $S_1$', visuals: [] },
          ],
          answer: 'A',
          explanation:
            'Since `*p = 2` (`10` in binary), `A = 1` and `B = 0`. Thus $Y = A \\cdot B = 0$, keeping the controller in $S_0$.',
          explanationVisuals: [],
        },
        {
          id: 'sec_1_q_4',
          contextIds: [],
          type: 'MSQ',
          marks: { correct: 4, wrong: -2, partial: 1 },
          prompt:
            'Select **all** compounds below that give a yellow precipitate of $\\ce{CHI3}$ (**iodoform test**) on warming with $\\ce{I2}$ and aqueous $\\ce{NaOH}$.',
          visuals: [],
          options: [
            {
              id: 'A',
              text: 'Ethanol',
              visuals: [
                {
                  id: 'oa1',
                  type: 'smiles',
                  title: null,
                  note: null,
                  data: 'CCO',
                },
              ],
            },
            {
              id: 'B',
              text: 'Methanol',
              visuals: [
                {
                  id: 'ob1',
                  type: 'smiles',
                  title: null,
                  note: null,
                  data: 'CO',
                },
              ],
            },
            {
              id: 'C',
              text: 'Acetophenone',
              visuals: [
                {
                  id: 'oc1',
                  type: 'smiles',
                  title: null,
                  note: null,
                  data: 'CC(=O)c1ccccc1',
                },
              ],
            },
            {
              id: 'D',
              text: 'Benzophenone',
              visuals: [
                {
                  id: 'od1',
                  type: 'smiles',
                  title: null,
                  note: null,
                  data: 'O=C(c1ccccc1)c2ccccc2',
                },
              ],
            },
          ],
          answer: ['A', 'C'],
          explanation:
            'Compounds possessing $\\ce{CH3-C(=O)-}$ or oxidizable $\\ce{CH3-CH(OH)-}$ groups yield $\\ce{CHI3}$:',
          explanationVisuals: [
            {
              id: 'ev1',
              type: 'table',
              title: 'Haloform Structural Summary',
              note: null,
              headers: ['Option', 'Formula', 'Reactive Moiety', 'Result'],
              rows: [
                ['A', '$\\ce{CH3CH2OH}$', '$\\ce{CH3CH(OH)-H}$', '**Positive**'],
                ['B', '$\\ce{CH3OH}$', 'Absent', 'Negative'],
                ['C', '$\\ce{PhCOCH3}$', '$\\ce{CH3CO-Ph}$', '**Positive**'],
                ['D', '$\\ce{PhCOPh}$', 'Absent', 'Negative'],
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'sec_2',
      title: 'Quantitative Aptitude & Analytical Reasoning (Section B)',
      duration: 20,
      totalQuestions: 2,
      maxAttempts: null,
      contexts: [],
      questions: [
        {
          id: 'sec_2_q_1',
          contextIds: [],
          type: 'MCQ',
          marks: { correct: 1, wrong: -0.25, partial: 0 },
          prompt:
            'A sum of $₹24,000$ is invested at $10\\%$ per annum compound interest compounded annually. Find the compound interest earned at the end of $2\\text{ years}$.',
          visuals: [],
          options: [
            { id: 'A', text: '$₹4,800$', visuals: [] },
            { id: 'B', text: '$₹5,040$', visuals: [] },
            { id: 'C', text: '$₹5,120$', visuals: [] },
            { id: 'D', text: '$₹5,240$', visuals: [] },
            { id: 'E', text: '$₹4,960$', visuals: [] },
          ],
          answer: 'B',
          explanation:
            'Effective 2-year CI rate at $10\\% = 10 + 10 + \\frac{10 \\times 10}{100} = 21\\%$. Compound Interest $= 21\\% \\text{ of } ₹24,000 = ₹5,040$.',
          explanationVisuals: [],
        },
        {
          id: 'sec_2_q_2',
          contextIds: [],
          type: 'NAT',
          marks: { correct: 1, wrong: 0, partial: 0 },
          prompt:
            'Pipe P fills a cistern in $12\\text{ hours}$ and Pipe Q empties the full cistern in $18\\text{ hours}$. If both pipes are opened simultaneously on an empty cistern, in how many hours will it be completely filled?',
          visuals: [],
          options: [],
          answer: [36, 36],
          explanation:
            'Net part filled per hour $= \\frac{1}{12} - \\frac{1}{18} = \\frac{3 - 2}{36} = \\frac{1}{36}$. Total time $= 36\\text{ hours}$.',
          explanationVisuals: [],
        },
      ],
    },
  ],
};

/**
 * Builds schema-compliant fallback ExamSets aligned with an ExamPack's MocktestTitles
 * when upstream Firebase Storage objects lack public tokens.
 */
export function buildFallbackExamSetsForPack(
  titles: MocktestTitleItem[],
  mode: 'sample' | 'full'
): ExamSet[] {
  const effectiveTitles =
    titles.length > 0
      ? mode === 'sample'
        ? titles.slice(0, 1)
        : titles
      : [
          {
            id: BENCHMARK_SET_1.id,
            title: BENCHMARK_SET_1.title,
            duration: 60,
            totalQuestions: 6,
            totalMarks: 13,
          },
        ];

  return effectiveTitles.map((meta, idx) => {
    const baseSections = BENCHMARK_SET_1.sections.map((sec, sIdx) => ({
      ...sec,
      id: `${meta.id}_sec_${sIdx + 1}`,
      duration:
        sIdx === 0
          ? Math.max(15, Math.round((meta.duration || 60) * 0.7))
          : Math.max(10, (meta.duration || 60) - Math.round((meta.duration || 60) * 0.7)),
      contexts: sec.contexts.map((c) => ({
        ...c,
        id: `${meta.id}_${c.id}`,
      })),
      questions: sec.questions.map((q) => ({
        ...q,
        id: `${meta.id}_${q.id}`,
        contextIds: q.contextIds.map((cid) => `${meta.id}_${cid}`),
      })),
    }));

    const qSum = baseSections.reduce((a, s) => a + s.questions.length, 0);
    const mSum = baseSections.reduce(
      (a, s) => a + s.questions.reduce((acc, q) => acc + q.marks.correct, 0),
      0
    );

    return {
      id: meta.id || `exam_set_${idx + 1}`,
      title: meta.title || `Mock Set 0${idx + 1}`,
      duration: meta.duration || 60,
      totalQuestions: qSum,
      totalMarks: mSum,
      sectionalTiming: true,
      calculator: idx % 2 === 0 ? 'scientific' : 'basic',
      sections: baseSections,
    };
  });
}
