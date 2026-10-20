import type { ScaleLevel } from "./types";

/** A ready-made scorecard: a named question set for a role, with one
 * bilingual, 1–4-scored question per scoring dimension. Loaded from the
 * Questions tab with one click. */
export interface ScorecardItem {
  category_en: string;
  category_es: string;
  text_en: string;
  text_es: string;
  scale: ScaleLevel[];
}
export interface Scorecard {
  set_name: string;
  role: string;
  items: ScorecardItem[];
}

// ---- Reusable 1–4 rubrics --------------------------------------------------
/** Riesgo, al derecho (D-605, 2026-10-19): 1 = lo peor (Afecta) … 4 = lo mejor (Sin riesgo), como todas las demás. Hasta aquí
 *  iba al revés con `descending: true` para que la media le diera la vuelta; medido: la base no conservaba esa marca en
 *  ninguna pregunta, así que «Sin riesgo» (1) contaba como lo peor. El dueño: «afecta sería número uno». */
const RISK: ScaleLevel[] = [
  { value: 1, label_en: "Affecting", label_es: "Afecta", example_en: "", example_es: "" },
  { value: 2, label_en: "Slightly Affecting", label_es: "Afecta levemente", example_en: "", example_es: "" },
  { value: 3, label_en: "Possible", label_es: "Posible", example_en: "", example_es: "" },
  { value: 4, label_en: "No Risk", label_es: "Sin riesgo", example_en: "", example_es: "" },
];
const GGMB: ScaleLevel[] = [
  { value: 1, label_en: "Bad / None", label_es: "Malo / Ninguno", example_en: "", example_es: "" },
  { value: 2, label_en: "Mediocre", label_es: "Mediocre", example_en: "", example_es: "" },
  { value: 3, label_en: "Good", label_es: "Bueno", example_en: "", example_es: "" },
  { value: 4, label_en: "Great", label_es: "Excelente", example_en: "", example_es: "" },
];
const SCORE10: ScaleLevel[] = [
  { value: 1, label_en: "1–3", label_es: "1–3", example_en: "", example_es: "" },
  { value: 2, label_en: "4–6", label_es: "4–6", example_en: "", example_es: "" },
  { value: 3, label_en: "7–8", label_es: "7–8", example_en: "", example_es: "" },
  { value: 4, label_en: "9–10", label_es: "9–10", example_en: "", example_es: "" },
];
const EDU: ScaleLevel[] = [
  { value: 1, label_en: "NA", label_es: "NA", example_en: "", example_es: "" },
  { value: 2, label_en: "NA", label_es: "NA", example_en: "", example_es: "" },
  { value: 3, label_en: "High School", label_es: "Preparatoria", example_en: "", example_es: "" },
  { value: 4, label_en: "College", label_es: "Universidad", example_en: "", example_es: "" },
];
// ---- Shared core block -----------------------------------------------------
/** The common, role-neutral questions every scorecard ends with. Role-specific
 * Experience / Performance items are spliced in ahead of these by each card.
 * `physical` and `closingExtra` let a role state its own demands instead of
 * carrying another role's (a driver's DOT card, a warehouse lift limit). */
function coreItems(opts: {
  schedule_en: string;
  schedule_es: string;
  /** The role's genuinely essential physical duties. Omit entirely for roles
   * that have none — asking a desk role about physical demands invites a
   * disability-related answer the interview has no reason to hear. */
  physical_en?: string;
  physical_es?: string;
  closingExtra_en?: string;
  closingExtra_es?: string;
}): ScorecardItem[] {
  return [
    {
      category_en: "Tenure", category_es: "Permanencia", scale: RISK,
      text_en: "Are you currently working? If not, how long have you been out of work? How long were you at your last job, and what led you to leave?",
      text_es: "¿Actualmente está trabajando? Si no, ¿cuánto tiempo lleva sin trabajar? ¿Cuánto tiempo estuvo en su último trabajo y qué lo llevó a dejarlo?",
    },
    {
      category_en: "Language Skill", category_es: "Idioma", scale: SCORE10,
      text_en: "On a scale of 1–10, how would you rate your Spanish for work? Can you give an example of using both languages at work?",
      text_es: "Del 1 al 10, ¿cómo calificarías tu nivel de inglés en el trabajo? ¿Puedes dar un ejemplo de cómo usas ambos idiomas en el trabajo?",
    },
    {
      category_en: "Education / Certifications", category_es: "Educación / Certificaciones", scale: EDU,
      text_en: "Aside from your high school education, have you completed any additional education, certifications, licenses, or specialized training? (e.g. Google, forklift, notary, liens, etc.)",
      text_es: "Además de la preparatoria, ¿has completado algún estudio adicional, certificación, licencia o capacitación especializada? (p. ej. Google, montacargas, notario, gravámenes, etc.)",
    },
    {
      // Absorbs the old "Second Jobs / Child / Elder Care" question. The need is
      // availability for the posted schedule; asking instead about childcare or
      // eldercare screens caregivers — in practice, women — for a fact the
      // schedule question already establishes.
      category_en: "Schedule & Availability", category_es: "Horario y disponibilidad", scale: RISK,
      text_en: `${opts.schedule_en} Do you have any other job or commitment that would keep you from working that schedule?`,
      text_es: `${opts.schedule_es} ¿Tiene otro empleo o compromiso que le impida cumplir ese horario?`,
    },
    {
      category_en: "Wage", category_es: "Salario", scale: RISK,
      text_en: "You likely saw a pay range listed. The final rate depends on experience and manager evaluation. What hourly rate are you hoping for? And what's the minimum you'd be comfortable accepting?",
      text_es: "Probablemente vio un rango salarial publicado. La tarifa final depende de la experiencia y de la evaluación del gerente. ¿Qué salario por hora está esperando? ¿Y cuál es el mínimo con el que se sentiría cómodo aceptando?",
    },
    {
      category_en: "Background Check", category_es: "Verificación de antecedentes", scale: RISK,
      text_en: "We run a background check after a conditional offer, not before. Is there anything relevant to this role you'd want us to know about ahead of that?",
      text_es: "Realizamos la verificación de antecedentes después de una oferta condicional, no antes. ¿Hay algo relevante para este puesto que quisiera comentarnos antes de eso?",
    },
    ...(opts.physical_en && opts.physical_es
      ? [{
          // ADA framing: ask only whether they can perform the essential duties,
          // with or without accommodation. Asking about past health or "issues
          // meeting physical demands" — as this once did — is a pre-offer
          // disability inquiry.
          category_en: "Physical Requirements", category_es: "Requisitos físicos", scale: RISK,
          text_en: `This role requires ${opts.physical_en} Can you perform those duties, with or without reasonable accommodation?`,
          text_es: `Este puesto requiere ${opts.physical_es} ¿Puede realizar esas funciones, con o sin adaptaciones razonables?`,
        } as ScorecardItem]
      : []),
    {
      category_en: "Attendance", category_es: "Asistencia", scale: RISK,
      text_en: "How do you make sure you're on time every day? What was your attendance record like in your last job?",
      text_es: "¿Cómo se asegura de llegar a tiempo todos los días? ¿Cómo fue su récord de asistencia en su último trabajo?",
    },
    {
      category_en: "Teamwork / Communication", category_es: "Trabajo en equipo / Comunicación", scale: GGMB,
      text_en: "Describe a time you disagreed with a coworker. How did you handle it? How do you make sure others understand what you need from them?",
      text_es: "Describa una ocasión en la que no estuvo de acuerdo con un compañero de trabajo. ¿Cómo manejó la situación? ¿Cómo te aseguras de que los demás entiendan lo que necesitas de ellos?",
    },
    {
      category_en: "Leadership Potential", category_es: "Liderazgo", scale: GGMB,
      text_en: "When something goes wrong and no one is in charge, what do you usually do? Do people naturally come to you with questions? Why do you think that is?",
      text_es: "Cuando ocurre un problema y no hay una persona responsable en ese momento, ¿cómo actúa usted? ¿La gente naturalmente acude a ti con preguntas? ¿Por qué crees que es así?",
    },
    {
      category_en: "Initiative", category_es: "Iniciativa", scale: GGMB,
      text_en: "If you finish your work early, what do you usually do? What's something you improved at your last job without being told?",
      text_es: "Si terminas tu trabajo antes de lo previsto, ¿qué sueles hacer con ese tiempo? ¿Qué es algo que mejoraste en tu último trabajo sin que te lo pidieran?",
    },
    {
      category_en: "Attitude", category_es: "Actitud", scale: GGMB,
      text_en: "What does 'doing a good job' mean to you? When something goes wrong at work, what do you do first?",
      text_es: "¿Qué significa para usted 'hacer un buen trabajo'? Cuando algo sale mal en el trabajo, ¿qué haces primero?",
    },
    {
      category_en: "Coachability", category_es: "Capacidad de aprendizaje", scale: GGMB,
      text_en: "Tell me about a time you were corrected or coached. How did you respond? If we show you a different way to do things, how do you approach it?",
      text_es: "Menciona una situación en la que le dieron retroalimentación directa. ¿Cómo respondiste? Si te mostramos una forma diferente de hacer las cosas, ¿cómo lo tomas?",
    },
    {
      // One question in place of four. "Stress Tolerance", "Personal Crises" and
      // "Lifestyle Strain" all probed the same thing — two shared the closing
      // clause "how does that affect your energy, schedule, or availability?"
      // verbatim — while "Personal Crises" invited candidates to volunteer
      // health and family details an interview has no reason to collect. What
      // remains is the job-relevant part: demanding days, and whether work
      // quality holds up through them.
      category_en: "Resilience", category_es: "Resiliencia", scale: GGMB,
      text_en: "Describe a stressful or unusually demanding day at work. How did you handle it, and how did you keep it from affecting the quality of your work?",
      text_es: "Describa un día estresante o de mucha exigencia en el trabajo. ¿Cómo lo manejó y cómo evitó que afectara la calidad de su trabajo?",
    },
    {
      category_en: "Versatility", category_es: "Versatilidad", scale: GGMB,
      text_en: "What different tasks or roles have you handled in one job? How do you feel about switching between tasks during the day?",
      text_es: "¿Qué distintas tareas o funciones ha desempeñado en un mismo trabajo? ¿Cómo se siente al cambiar de tarea durante el día?",
    },
    {
      category_en: "Trust Level", category_es: "Confianza", scale: GGMB,
      text_en: "Have you ever made a mistake that cost your employer money? What did you do? If you see a coworker doing something unsafe or wrong, what do you do?",
      text_es: "¿Alguna vez ha cometido un error que le costó dinero a la empresa? ¿Qué hizo? Si ve a un compañero haciendo algo inseguro o incorrecto, ¿qué hace?",
    },
    {
      // Absorbs the old "Other" question — both were wrap-up.
      category_en: "Closing", category_es: "Cierre", scale: GGMB,
      text_en: `What part of this role do you think you'd enjoy most, and what would be hardest? What would make us say in 90 days "we're glad we hired you"? Any questions for us? Please bring a valid photo ID${opts.closingExtra_en ?? ""}.`,
      text_es: `¿Qué parte de este puesto cree que disfrutaría más y cuál sería la más difícil? ¿Qué tendría que suceder en 90 días para que digamos "nos alegra haberlo contratado"? ¿Tiene alguna pregunta? Por favor traiga una identificación con foto válida${opts.closingExtra_es ?? ""}.`,
    },
  ];
}

// Reusable shorthands for the role-specific rows.
const EXP = (text_en: string, text_es: string): ScorecardItem => ({
  category_en: "Experience", category_es: "Experiencia", scale: GGMB, text_en, text_es,
});
const PERF = (text_en: string, text_es: string): ScorecardItem => ({
  category_en: "Performance: Results", category_es: "Desempeño: Resultados", scale: GGMB, text_en, text_es,
});
const EXP_RISK = (text_en: string, text_es: string): ScorecardItem => ({
  category_en: "Experience", category_es: "Experiencia", scale: RISK, text_en, text_es,
});

// Warehouse roles share the same forklift / inventory / floor-standards questions.
const WAREHOUSE_EXPERIENCE: ScorecardItem[] = [
  EXP(
    "How many years of forklift experience do you have?",
    "¿Cuántos años de experiencia tienes manejando montacargas?",
  ),
  EXP(
    "Have you done inventory counts or cycle counts before? If yes: roughly how often? (daily / weekly / monthly)",
    "¿Tiene experiencia haciendo conteos de inventario o conteos cíclicos? Si es así, ¿con qué frecuencia? (diario / semanal / mensual)",
  ),
  EXP(
    "Have you ever been responsible for investigating or resolving inventory discrepancies?",
    "¿Alguna vez ha sido responsable de investigar o resolver diferencias de inventario?",
  ),
  EXP(
    "What systems or software have you used to track inventory? (Examples: WMS, ERP, Excel, scanners, handhelds)",
    "¿Qué programas has usado para monitorear inventario? (Ejemplos: WMS, ERP, Excel, escáneres, handhelds)",
  ),
];

const WAREHOUSE_PERFORMANCE: ScorecardItem[] = [
  PERF(
    "Have you worked in warehouses with organization standards? If yes: describe briefly (5S, labeling, pallet zones, etc.)",
    "¿Ha trabajado en almacenes que siguen estándares de organización? Si es así, descríbalo brevemente (5S, etiquetado, zonas de tarimas, etc.)",
  ),
  PERF(
    "Have you worked in warehouses with cleanliness standards? If yes: describe briefly (5S, labeling, pallet zones, etc.)",
    "¿Ha trabajado en almacenes que siguen estándares de limpieza? Si es así, descríbalo brevemente (5S, etiquetado, zonas de tarimas, etc.)",
  ),
  PERF(
    "How was your pace or productivity tracked? Aka how did you know whether you were working fast enough?",
    "¿Cómo evaluaban su productividad? ¿Cómo sabías que estabas teniendo el ritmo requerido?",
  ),
  PERF(
    "How was accuracy measured in your last warehouse role? Aka how did you personally make sure your work was correct?",
    "¿Cómo controlaban la exactitud de su trabajo y qué hacía usted para asegurarse de que cumplía con los estándares que se solicitaban?",
  ),
  PERF(
    "What did you do to avoid damaging product or creating scrap?",
    "¿Qué prácticas seguía para prevenir daños al producto o la creación de merma / scrap?",
  ),
];

// A sentence fragment: coreItems renders it as "This role requires <physical>".
// Essential physical duties only — attendance and reliability are asked
// separately and are not what an ADA accommodation question is about.
const WAREHOUSE_PHYSICAL = {
  physical_en: "standing for long periods, lifting up to 50 lb, and operating powered equipment.",
  physical_es: "estar de pie por períodos prolongados, levantar hasta 50 lb y operar equipo motorizado.",
};
const WAREHOUSE_SCHEDULE = {
  schedule_en: "This is a full-time, 40-hour role with rotating schedules: Monday–Saturday 8–4 or Monday–Friday 9–6. Some overtime may be available. Does that schedule work for you?",
  schedule_es: "Este es un trabajo de tiempo completo, 40 horas, con horarios rotativos de Lunes a Sábado de 8–4 o Lunes a Viernes de 9–6. Puede haber horas extra disponibles. ¿Ese horario le funciona?",
};

// ---- Sales Representative --------------------------------------------------
export const SALES_REP_SCORECARD: Scorecard = {
  set_name: "Sales Representative",
  role: "Sales Representative",
  items: [
    EXP(
      "How many total years of sales experience do you have? What type of sales? (retail, B2B, inside, outside)",
      "¿Cuántos años de experiencia en ventas tienes en total? ¿Qué tipo de ventas? (retail, B2B, ventas internas, ventas externas)",
    ),
    EXP(
      "Have you done cold calling, door-to-door, or outbound sales before?",
      "¿Has hecho llamadas en frío, ventas puerta a puerta o ventas de prospección (outbound)?",
    ),
    EXP(
      "Computer literacy: What systems or software have you used daily in a sales role? (CRM, email, ERP, POS, Excel)",
      "Manejo de computadora: ¿Qué sistemas o programas has usado a diario en un puesto de ventas? (CRM, correo electrónico, ERP, punto de venta, Excel)",
    ),
    EXP(
      "Which CRMs have you used before? What did you mainly use it for? (notes, follow-ups, pipeline, quotes)",
      "¿Qué CRMs has utilizado? ¿Para qué lo usabas principalmente? (notas, seguimientos, pipeline, cotizaciones)",
    ),
    PERF(
      "What was your typical monthly sales volume in your last role?",
      "¿Cuál era tu volumen de ventas mensual típico en tu puesto anterior?",
    ),
    PERF(
      "Were you typically above, at, or below quota?",
      "¿Normalmente estabas por encima, en, o por debajo de tu cuota?",
    ),
    PERF(
      "Was that performance fairly consistent month to month, or more up and down?",
      "¿Ese desempeño era bastante constante mes a mes, o variaba bastante?",
    ),
    PERF(
      "How much of that was directly your responsibility?",
      "¿Qué parte de eso era directamente tu responsabilidad?",
    ),
    PERF(
      "How do you normally keep track of leads?",
      "¿Cómo llevas normalmente el seguimiento de tus prospectos (leads)?",
    ),
    // No physical_* — sales has no essential physical duties worth an
    // accommodation question; being "on the sales floor" is not one.
    ...coreItems({
      schedule_en: "This is a full-time, 40-hour role with rotating schedules: Monday–Saturday 8–4 or Monday–Friday 9–6. Some overtime may be available. Does that schedule work for you?",
      schedule_es: "Este es un trabajo de tiempo completo, 40 horas, con horarios rotativos de Lunes a Sábado de 8–4 o Lunes a Viernes de 9–6. Puede haber horas extra disponibles. ¿Ese horario le funciona?",
    }),
  ],
};

// ---- Warehouse Supervisor --------------------------------------------------
export const WAREHOUSE_SUPERVISOR_SCORECARD: Scorecard = {
  set_name: "Warehouse Supervisor",
  role: "Warehouse Supervisor",
  items: [
    ...WAREHOUSE_EXPERIENCE,
    EXP(
      "Tell me about the largest team you've directly supervised and what you were responsible for.",
      "¿Cuál ha sido el equipo más grande que ha supervisado y qué tareas estaban bajo su responsabilidad?",
    ),
    ...WAREHOUSE_PERFORMANCE,
    PERF(
      "Tell me about a time you had to correct or coach someone on your team. What did you do?",
      "Describa una situación en la que tuvo que corregir o guiar a un miembro de su equipo. ¿Cómo lo manejó?",
    ),
    PERF(
      "How did you keep the team on track during busy or stressful days?",
      "¿Cómo apoyaba al equipo para que se mantuviera enfocado y cumpliendo objetivos en momentos de estrés o mucho trabajo?",
    ),
    ...coreItems({ ...WAREHOUSE_SCHEDULE, ...WAREHOUSE_PHYSICAL }),
  ],
};

// ---- Inventory Coordinator -------------------------------------------------
export const INVENTORY_COORDINATOR_SCORECARD: Scorecard = {
  set_name: "Inventory Coordinator",
  role: "Inventory Coordinator",
  items: [
    ...WAREHOUSE_EXPERIENCE,
    ...WAREHOUSE_PERFORMANCE,
    ...coreItems({ ...WAREHOUSE_SCHEDULE, ...WAREHOUSE_PHYSICAL }),
  ],
};

// ---- Warehouse Associate ---------------------------------------------------
export const WAREHOUSE_ASSOCIATE_SCORECARD: Scorecard = {
  set_name: "Warehouse Associate",
  role: "Warehouse Associate",
  items: [
    ...WAREHOUSE_EXPERIENCE,
    ...WAREHOUSE_PERFORMANCE,
    ...coreItems({ ...WAREHOUSE_SCHEDULE, ...WAREHOUSE_PHYSICAL }),
  ],
};

// ---- Driver ----------------------------------------------------------------
export const DRIVER_SCORECARD: Scorecard = {
  set_name: "Driver",
  role: "Driver",
  items: [
    EXP(
      "Do you have a valid CDL A? (Required)",
      "¿Tiene una licencia CDL A vigente? (Requisito)",
    ),
    EXP(
      "How many years of commercial driving experience do you have? (Required)",
      "¿Cuántos años de experiencia en conducción comercial tiene? (Requisito)",
    ),
    EXP(
      "How many years of forklift experience do you have?",
      "¿Cuántos años de experiencia tienes manejando montacargas?",
    ),
    EXP(
      "How many years of piggyback / truck-mounted forklift experience do you have?",
      "¿Cuántos años de experiencia tiene con montacargas tipo piggyback (montado en camión)?",
    ),
    EXP_RISK(
      "Any moving violations or at-fault accidents in the last 3 years?",
      "¿Ha tenido infracciones de tránsito o accidentes con culpa en los últimos 3 años?",
    ),
    EXP_RISK(
      "Any failed or refused drug or alcohol tests?",
      "¿Ha reprobado o rechazado alguna prueba de drogas o alcohol?",
    ),
    PERF(
      "What would your last supervisor say about the condition of your truck?",
      "¿Qué diría su último supervisor sobre el estado en que mantenía su camión?",
    ),
    PERF(
      "How did you balance staying on schedule without rushing or taking shortcuts?",
      "¿Cómo lograba cumplir con los tiempos de entrega sin apresurarse ni tomar atajos?",
    ),
    PERF(
      "How did you personally make sure your deliveries were done safely and correctly?",
      "¿Cómo se aseguraba personalmente de que sus entregas se hicieran de forma segura y correcta?",
    ),
    ...coreItems({
      schedule_en: "This is a full-time, 40-hour role with rotating schedules: Monday–Saturday 8–4 or Monday–Friday 9–6. Some overtime may be available. Does that schedule work for you?",
      schedule_es: "Este es un trabajo de tiempo completo, 40 horas, con horarios rotativos de Lunes a Sábado de 8–4 o Lunes a Viernes de 9–6. Puede haber horas extra disponibles. ¿Ese horario le funciona?",
      physical_en: "driving for extended periods, loading and unloading, and lifting up to 50 lb.",
      physical_es: "conducir por períodos prolongados, cargar y descargar, y levantar hasta 50 lb.",
      closingExtra_en: ", your CDL, and your DOT medical card",
      closingExtra_es: ", su CDL y su tarjeta médica DOT",
    }),
  ],
};

// ---- Accounting ------------------------------------------------------------
export const ACCOUNTING_SCORECARD: Scorecard = {
  set_name: "Accounting",
  role: "Accounting",
  items: [
    EXP(
      "How many years of accounting experience do you have?",
      "¿Cuántos años de experiencia tienes en contabilidad?",
    ),
    EXP(
      "Have you handled A/R, A/P, payroll, sales tax, or reconciliations?",
      "¿Has manejado cuentas por cobrar (A/R), cuentas por pagar (A/P), nómina, impuestos sobre ventas (sales tax) o conciliaciones bancarias?",
    ),
    EXP(
      "Are you comfortable with Excel? Which formulas/tools do you use?",
      "¿Te sientes cómodo(a) usando Excel? ¿Qué fórmulas o herramientas utilizas con mayor frecuencia?",
    ),
    EXP(
      "What accounting/ERP systems have you used? Have you used QuickBooks Desktop?",
      "¿Qué sistemas contables o ERP has utilizado? ¿Has trabajado con QuickBooks Desktop?",
    ),
    EXP(
      "Have you worked for a retail, distribution, construction, or inventory-based business?",
      "¿Has trabajado en empresas de venta al por menor (retail), distribución, construcción o con manejo de inventarios?",
    ),
    {
      category_en: "Skills Test", category_es: "Prueba técnica", scale: GGMB,
      text_en: "What is a credit memo used for? If sales are $100 and sales tax is 8.25%, how much tax is collected?",
      text_es: "¿Para qué se utiliza una nota de crédito (credit memo)? Si una venta es de $100 y el impuesto sobre ventas es del 8.25%, ¿cuánto impuesto se debe cobrar?",
    },
    PERF(
      "What were some of your daily goals in your previous job?",
      "¿Cuáles eran algunos de tus objetivos diarios en tu trabajo anterior?",
    ),
    PERF(
      "How did you personally make sure your work was correct before submitting it?",
      "¿Cómo te asegurabas personalmente de que tu trabajo estuviera correcto antes de entregarlo o registrarlo?",
    ),
    PERF(
      "What accounting reports or KPIs were you responsible for reviewing regularly? (A/R aging, A/P aging, bank reconciliations, inventory valuation, P&L, Balance Sheet, cash flow.)",
      "¿Qué reportes contables o indicadores (KPIs) revisabas de manera regular? (Antigüedad de A/R, antigüedad de A/P, conciliaciones bancarias, valuación de inventario, Estado de Resultados (P&L), Balance General y flujo de efectivo.)",
    ),
    PERF(
      "Describe the month-end closing process at your last company. What were your specific responsibilities?",
      "Describe el proceso de cierre de fin de mes en tu empresa anterior. ¿Cuáles eran tus responsabilidades específicas?",
    ),
    PERF(
      "Have you ever trained or coached another employee on accounting procedures or software? If yes, what did you teach them?",
      "¿Alguna vez capacitaste o ayudaste a entrenar a otro empleado en procedimientos contables o en el uso de un software de contabilidad? Si es así, ¿qué le enseñaste?",
    ),
    // No physical_* — this is a desk role. It previously asked about lifting
    // 50 lb and driving, and closed by requesting a CDL and DOT medical card,
    // all inherited from a driver template.
    ...coreItems({
      schedule_en: "This is a full-time, 40-hour role with rotating schedules: Monday–Saturday 8–4 or Monday–Friday 9–6. Some overtime may be available. Does that schedule work for you?",
      schedule_es: "Este es un trabajo de tiempo completo, 40 horas, con horarios rotativos de Lunes a Sábado de 8–4 o Lunes a Viernes de 9–6. Puede haber horas extra disponibles. ¿Ese horario le funciona?",
    }),
  ],
};

export const SCORECARDS: Scorecard[] = [
  ACCOUNTING_SCORECARD,
  SALES_REP_SCORECARD,
  WAREHOUSE_SUPERVISOR_SCORECARD,
  INVENTORY_COORDINATOR_SCORECARD,
  WAREHOUSE_ASSOCIATE_SCORECARD,
  DRIVER_SCORECARD,
];
