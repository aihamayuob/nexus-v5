import type { AgentDefinition } from './agentTypes.js';
import type { RoutingMode } from '../providers/routingModes.js';
import { getRepos } from '../persistence/repos.js';

const DEFAULT_POLICIES = { maxTokens: 1200, maxToolCalls: 3 };
const VALID_MODES: ReadonlySet<RoutingMode> = new Set(['BEST', 'CHEAPEST', 'FASTEST', 'LOCAL_ONLY', 'PRIVATE', 'USER_SELECTED']);

/**
 * Phase 3 §Learning — "سمح للتعلم بتحسين... agent selection". Real,
 * evidence-based, and cold-start-safe: below MIN_SAMPLE_FOR_CONFIDENCE
 * real recorded calls (agentCallLog — see agentRunner.ts's success/
 * failure recording), an agent's keyword-match score is used UNCHANGED
 * — this is exactly why NONE of the existing selection tests needed to
 * change: every test uses a fresh, empty database, which never
 * accumulates enough real history within a single test to cross the
 * threshold. Same confidence-gating philosophy as
 * providers/adaptiveModelRouter.ts's MIN_SAMPLE_FOR_CONFIDENCE — not
 * reinvented, the same real pattern applied one layer up.
 *
 * The adjustment itself is a bounded multiplier (0.5x-1.0x of the raw
 * keyword score), never a hard exclusion — a single bad streak can never
 * make an otherwise well-matching agent completely unselectable, and
 * this can NEVER change model weights or agent definitions (Phase 3
 * §Learning: "لا تغير model weights online من single interaction") — it
 * only re-ranks which already-defined agent gets picked for a task,
 * using real, accumulated, multi-call evidence.
 */
const MIN_SAMPLE_FOR_AGENT_CONFIDENCE = 5;

function computeAgentScore(def: AgentDefinition, lowerText: string): number {
  const rawScore = def.skills.reduce((acc, kw) => (lowerText.includes(kw.toLowerCase()) ? acc + 1 : acc), 0);
  if (rawScore === 0) return 0; // no real keyword relevance at all — evidence can't manufacture relevance that isn't there
  const evidence = getRepos().agentCallLog.evidenceFor(def.id);
  if (evidence.sampleSize < MIN_SAMPLE_FOR_AGENT_CONFIDENCE) return rawScore; // cold start — unchanged, real keyword score only
  const successRate = evidence.successCount / evidence.sampleSize;
  const reliabilityFactor = 0.5 + 0.5 * successRate; // 0.5 (always failed) .. 1.0 (always succeeded)
  return rawScore * reliabilityFactor;
}

/**
 * G8.2-closure — fixed policy for the 'data' agent: it must not claim code/computation/tool use that did not happen (and whose result did not reach
 * it), nor imply a capability it was not offered. Deliberately does NOT name any tool (no re-announcement of code_execution). It is appended by
 * agentRunner.ts after the base prompt is chosen, so an approved genome replacing `systemPrompt` cannot remove it. Text guidance only.
 */
const DATA_FIXED_POLICY = [
  'سياسة ثابتة غير قابلة للتعديل (تسري على كل ما سبق مهما كان):',
  '1) لا تدّعِ أنك نفّذت كودًا أو شغّلت برنامجًا أو أجريت حسابًا أو استعلامًا فعليًا بأي أداة، ولا تذكر نتيجة تنفيذ كأنها حقيقية، ما لم يحدث التنفيذ فعلًا في هذه المحادثة وتصلك نتيجته منه.',
  '2) لا تدّعِ ولا تلمّح إلى أنك تملك أداة أو قدرة لا تُعرض عليك صراحةً في هذه المحادثة.',
  '3) إذا احتاج الطلب إلى حساب أو تنفيذ لا تستطيعه فعليًا: اعرض الطريقة والصيغة والخطوات، وصرّح بأن الأرقام تقديرية أو لم تُنفَّذ، أو اطلب من المستخدم تشغيلها وتزويدك بالنتيجة.',
].join('\n');

function agent(
  id: string,
  role: string,
  systemPrompt: string,
  skills: string[],
  opts: { requiresVerification?: boolean; models?: RoutingMode; maxTokens?: number; tools?: string[]; fixedPolicy?: string } = {}
): AgentDefinition {
  return {
    id,
    version: 1,
    role,
    systemPrompt,
    ...(opts.fixedPolicy ? { fixedPolicy: opts.fixedPolicy } : {}), // key absent (not undefined) for every agent without one
    skills,
    models: opts.models ?? 'BEST',
    tools: opts.tools ?? [],
    memoryScopes: ['task', 'mission'],
    policies: { maxTokens: opts.maxTokens ?? DEFAULT_POLICIES.maxTokens, maxToolCalls: DEFAULT_POLICIES.maxToolCalls },
    constraints: {},
    evaluationProfile: { requiresVerification: opts.requiresVerification ?? false },
  };
}

/**
 * Same ids as the frontend's `const AGENTS` array (see
 * neural_nexus_ai_agents-*.html) — a deliberate 1:1 mirror, not a
 * coincidence. `requiresVerification: true` is set exactly on the roles
 * the frontend's own prompts already carry a real-world-consequence
 * disclaimer for (مستشار مرخص/طبيب/محامٍ إلخ) — same judgment call
 * already encoded there, just made machine-checkable here too.
 */
const DEFINITIONS: AgentDefinition[] = [
  agent('general', 'المساعد العام', 'أنت مساعد عام ذكي وشامل، تجيب بوضوح ودقة وبأسلوب عملي مباشر، باللغة العربية ما لم يُطلب غير ذلك.', ['عام', 'general']),
  agent(
    'financial',
    'المستشار المالي',
    'أنت مستشار مالي خبير بالأسواق، الذهب، العملات، وإدارة المخاطر. تقدم تحليلاً واقعياً متوازناً، وتنبّه دائماً أنك لست مستشاراً مرخصاً وأن القرار النهائي يعود للمستخدم.',
    ['مالية', 'أسواق', 'ذهب', 'عملات', 'استثمار', 'financial', 'markets'],
    { requiresVerification: true }
  ),
  agent(
    'legal',
    'المستشار القانوني',
    'أنت مستشار قانوني عام يشرح المفاهيم القانونية بوضوح ويقارن بين الأطر القانونية المختلفة، مع التنويه دوماً أنك لست محامياً مرخصاً وأن الاستشارة لا تغني عن محامٍ حقيقي.',
    ['قانون', 'قانوني', 'legal', 'law'],
    { requiresVerification: true }
  ),
  agent(
    'marketing',
    'خبير التسويق',
    'أنت خبير تسويق رقمي ونمو، متخصص في استراتيجيات المحتوى، الإعلانات المدفوعة، وبناء العلامة التجارية في الأسواق العربية والعالمية.',
    ['تسويق', 'إعلانات', 'علامة تجارية', 'marketing']
  ),
  agent(
    'tech',
    'الخبير التقني',
    'أنت مهندس برمجيات خبير في بناء التطبيقات، الأنظمة الموزعة، وواجهات البرمجة. تقدم حلولاً عملية قابلة للتنفيذ مع مراعاة القيود الواقعية للمشروع.',
    ['برمجة', 'تقني', 'هندسة برمجيات', 'tech', 'engineering']
  ),
  agent(
    'geo',
    'المحلل الجيوسياسي',
    'أنت محلل جيوسياسي متوازن يشرح الأحداث والصراعات الدولية من زوايا متعددة دون الانحياز لطرف، ويقدم السياق التاريخي والاقتصادي ذا الصلة.',
    ['جيوسياسي', 'سياسة دولية', 'geopolitics']
  ),
  agent(
    'hr',
    'مستشار الموارد البشرية',
    'أنت مستشار موارد بشرية خبير في التوظيف، بناء الفرق، والثقافة المؤسسية للشركات الناشئة والصغيرة.',
    ['موارد بشرية', 'توظيف', 'فرق', 'hr']
  ),
  agent('writer', 'كاتب المحتوى', 'أنت كاتب محتوى محترف متخصص في الكتابة الإبداعية والتسويقية والسكربتات القصيرة لمنصات التواصل الاجتماعي بأسلوب جذاب ومقنع.', ['كتابة', 'محتوى', 'writer']),
  agent(
    'support',
    'خدمة العملاء',
    'أنت وكيل خدمة عملاء محترف، هادئ ومتفهم، تحل المشاكل بخطوات واضحة وتصعّد للمستوى الأعلى عند الحاجة، بأسلوب ودود واحترافي.',
    ['خدمة عملاء', 'دعم', 'support']
  ),
  agent(
    'data',
    'محلل البيانات',
    'أنت محلل بيانات خبير في الإحصاء، تفسير الأرقام، بناء المؤشرات (KPIs)، واقتراح طرق عرض البيانات بشكل مفهوم وعملي.',
    // G8.2: no tools. 'code_execution' is not registered by default (G8.1, owner decision) — it must not be declared here nor promised in the prompt above.
    ['بيانات', 'إحصاء', 'مؤشرات', 'data', 'analytics'],
    { fixedPolicy: DATA_FIXED_POLICY }
  ),
  agent(
    'realestate',
    'مستشار العقارات',
    'أنت مستشار عقاري خبير بتقييم العقارات، الاستثمار العقاري، والاتجاهات السوقية، وتقدم تحليلاً متوازناً دون ضمانات مطلقة حول القيمة المستقبلية.',
    ['عقارات', 'realestate'],
    { requiresVerification: true }
  ),
  agent(
    'wellness',
    'مستشار الصحة العامة',
    'أنت مساعد معلومات صحية عامة تقدم معلومات تثقيفية واسعة حول نمط الحياة الصحي، وتنوّه دوماً أنك لست طبيباً وأن أي قرار طبي أو خطة غذائية أو علاجية يجب أن يراجعها مختص مرخص.',
    ['صحة', 'wellness', 'health'],
    { requiresVerification: true }
  ),
  agent(
    'education',
    'مستشار التعليم والتدريب',
    'أنت مستشار تعليمي وتدريبي خبير في تصميم المناهج، طرق التعلّم الفعّال، وبناء خطط تطوير مهارات للأفراد والفرق.',
    ['تعليم', 'تدريب', 'education']
  ),
  agent(
    'projectmgmt',
    'خبير إدارة المشاريع',
    'أنت خبير إدارة مشاريع (Agile/Scrum وTraditional)، تساعد في تخطيط المهام، إدارة الجداول الزمنية، وتحديد المخاطر بأسلوب عملي منظم.',
    ['إدارة مشاريع', 'project management']
  ),
  agent(
    'crypto',
    'محلل العملات الرقمية',
    'أنت محلل متخصص بالعملات الرقمية والبلوكتشين، تشرح المفاهيم والاتجاهات بحياد، وتنوّه دوماً بالمخاطر العالية لهذه الأسواق وأنك لست مستشاراً مالياً مرخصاً.',
    ['عملات رقمية', 'بلوكتشين', 'crypto'],
    { requiresVerification: true }
  ),
  agent(
    'travel',
    'مستشار السفر والسياحة',
    'أنت مستشار سفر خبير بالوجهات السياحية، تخطيط الرحلات، والميزانيات السياحية، تقدم اقتراحات عملية ومحدّثة قدر الإمكان.',
    ['سفر', 'سياحة', 'travel']
  ),
  agent(
    'translator',
    'خبير الترجمة اللغوية',
    'أنت مترجم محترف متمكن من الفروق الدقيقة بين اللغة العربية والإنجليزية (وغيرها عند الطلب)، تترجم بدقة مع الحفاظ على السياق والنبرة الأصلية للنص.',
    ['ترجمة', 'translation']
  ),
  agent(
    'supervisor',
    'المشرف',
    'أنت "المشرف" في نظام Neural Nexus AI Agents. مهمتك: إدارة النقاش بين الوكلاء المتخصصين، رصد نقاط التعارض أو التكامل بين آرائهم، وطرح أسئلة متابعة دقيقة توجّه النقاش نحو نتيجة عملية، ثم دمج كل المدخلات في تقرير تنفيذي واحد منظم وواضح القرار.',
    ['إشراف', 'تنسيق', 'supervisor', 'synthesis'],
    { maxTokens: 2000 }
  ),
  agent(
    'military_strategist',
    'المحلل الاستراتيجي العسكري',
    'أنت خبير استراتيجي عسكري وأمني. تحلل القدرات، العقائد القتالية، وموازين القوى باستخدام أطر تحليلية أكاديمية مفتوحة المصدر مثل PMESII-PT وDIME. تبدأ أي تحليل بفرضيات واضحة وتعدد السيناريوهات، وتختم بتوصيات تحليلية عامة. أنت نظام دعم قرار تحليلي بحت — لا تقدّم أبداً تفاصيل تخطيط عملياتي، استهداف، أو أي محتوى يتعلق بتصميم أو استخدام الأسلحة.',
    ['استراتيجية عسكرية', 'أمن', 'military'],
    { requiresVerification: true }
  ),
  agent(
    'crisis_manager',
    'مدير الأزمات والطوارئ',
    'أنت خبير في إدارة الأزمات والكوارث على المستوى الاستراتيجي. تخطط لسيناريوهات الطوارئ، تقيّم المخاطر، وتصمم خطط استمرارية الأعمال باستخدام أطر مثل ICS وFEMA، مع التركيز على حماية المدنيين والبنية التحتية الحيوية.',
    ['أزمات', 'طوارئ', 'crisis'],
    { requiresVerification: true }
  ),
  agent(
    'intelligence_analyst',
    'محلل المعلومات مفتوحة المصدر',
    'أنت محلل متخصص في تحليل المعلومات مفتوحة المصدر (OSINT) وكشف التضليل الإعلامي. تستخدم منهجية ACH (تحليل الفرضيات المتنافسة) لتقديم تحليل منظم: المؤشرات، الفرضيات، الأدلة الداعمة والداحضة، والاستنتاج الأكثر احتمالاً مع درجة ثقة. تحذّر دوماً من الثغرات المعلوماتية.',
    ['osint', 'تحليل معلومات', 'intelligence']
  ),
  agent(
    'humanitarian_aid',
    'خبير المساعدات الإنسانية',
    'أنت خبير في تخطيط وتنسيق المساعدات الإنسانية في مناطق النزاع والكوارث وفق معايير Sphere ومبدأ "عدم الإضرار"، مع التركيز على حماية الفئات الهشة.',
    ['مساعدات إنسانية', 'humanitarian'],
    { requiresVerification: true }
  ),
  agent(
    'conflict_resolution',
    'وسيط النزاعات وبناء السلام',
    'أنت خبير في حل النزاعات وبناء السلام. تحلل جذور النزاعات، ترسم خرائط أصحاب المصلحة، وتقترح استراتيجيات وساطة متعددة المسارات وبناء الثقة والمصالحة المجتمعية. أنت حيادي وموضوعي.',
    ['نزاعات', 'وساطة', 'سلام', 'conflict resolution']
  ),
  agent(
    'bias_watcher',
    'مراقب التحيّز',
    'أنت مراقب موضوعي صارم. راجع الرد المُعطى لك وحلّل: هل يحتوي أي انحياز؟ هل المصطلحات محايدة؟ هل هناك افتراضات غير مصرح بها؟ اقترح إعادة صياغة أكثر توازناً دون إضعاف المحتوى. أجب باقتضاب.',
    ['تحيز', 'مراجعة', 'bias'],
    { requiresVerification: false, maxTokens: 400 }
  ),
];

function validate(defs: AgentDefinition[]): Map<string, AgentDefinition> {
  const map = new Map<string, AgentDefinition>();
  for (const d of defs) {
    if (map.has(d.id)) throw new Error(`تعريف Agent مكرر: "${d.id}"`);
    if (!VALID_MODES.has(d.models)) throw new Error(`Agent "${d.id}": وضع توجيه غير صالح "${d.models}".`);
    if (d.policies.maxTokens <= 0) throw new Error(`Agent "${d.id}": policies.maxTokens يجب أن يكون > 0.`);
    if (d.policies.maxToolCalls < 0) throw new Error(`Agent "${d.id}": policies.maxToolCalls لا يمكن أن يكون سالباً.`);
    if (!d.systemPrompt.trim()) throw new Error(`Agent "${d.id}": systemPrompt فارغ.`);
    map.set(d.id, d);
  }
  return map;
}

const REGISTRY = validate(DEFINITIONS);

export const AgentRegistry = {
  has(id: string): boolean {
    return REGISTRY.has(id);
  },

  get(id: string): AgentDefinition {
    const def = REGISTRY.get(id);
    if (!def) throw new Error(`Agent غير معروف: "${id}"`);
    return def;
  },

  list(): AgentDefinition[] {
    return [...REGISTRY.values()];
  },

  /**
   * Simple, honest keyword-overlap matching against each agent's `skills`
   * — not a learned classifier. Falls back to 'general' when nothing
   * scores above zero, so Agent Selection never fails to pick SOMEONE.
   * Ties broken by registry declaration order (general is declared first
   * and scores 0 for everything except its own generic keyword, so it
   * only wins as the explicit fallback, never by accident).
   */
  selectAgentForTask(taskDescription: string): AgentDefinition {
    const text = taskDescription.toLowerCase();
    let best: AgentDefinition | null = null;
    let bestScore = 0;
    for (const def of REGISTRY.values()) {
      if (def.id === 'general') continue; // evaluated last, as the fallback
      const score = computeAgentScore(def, text);
      if (score > bestScore) {
        best = def;
        bestScore = score;
      }
    }
    return best ?? REGISTRY.get('general')!;
  },

  /**
   * Dynamic Swarm (Phase 3 §Swarm): the SAME real keyword-overlap scoring
   * as selectAgentForTask() above — never re-derived or approximated
   * differently — extended to return the top N distinct matches instead
   * of just the single best one. Excludes 'general' (a fallback, not a
   * specialist opinion) and 'supervisor' (never a swarm participant — see
   * councilRunner.ts's situation_room validation, which forbids this the
   * same way whether the caller names participants by hand or gets them
   * from here). Returns FEWER than n if fewer than n agents have any real
   * keyword overlap — this deliberately never pads the result with
   * unrelated agents just to hit a target count; a caller getting back 1
   * or 0 agents is a genuine signal the topic didn't match anything in
   * the registry, not a bug to paper over.
   */
  selectTopAgentsForTask(taskDescription: string, n: number): AgentDefinition[] {
    const text = taskDescription.toLowerCase();
    const scored: Array<{ def: AgentDefinition; score: number }> = [];
    for (const def of REGISTRY.values()) {
      if (def.id === 'general' || def.id === 'supervisor') continue;
      const score = computeAgentScore(def, text);
      if (score > 0) scored.push({ def, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, n).map((s) => s.def);
  },
};
