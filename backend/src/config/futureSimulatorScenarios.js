export const SCENARIO_VERSION = 1;

export const METRIC_KEYS = Object.freeze([
  "energy", "resources", "freeTime", "workload", "stress", "experience", "professionalNetwork",
]);

const stages = Object.freeze(["start", "adaptation", "development", "experience", "final_stretch", "result"]);
const metrics = (effects) => Object.freeze(effects);
const option = (id, label, effects, explanation, nextEventId, flags = {}) => Object.freeze({ id, label, effects: metrics(effects), explanation, nextEventId, flags });
const event = (id, stage, title, description, options, tracks = []) => Object.freeze({ id, stage, title, description, options: Object.freeze(options), tracks: Object.freeze(tracks) });

const baseEvents = [
  event("start_organize", "start", "Organizar tu comienzo", "Se acumulan pendientes iniciales y necesitas elegir cómo ordenar tu tiempo.", [
    option("plan", "Hacer un plan semanal realista", { workload: -8, stress: -7, freeTime: -3 }, "Priorizaste ordenar actividades antes de abarcar más.", "adapt_support"),
    option("improvise", "Resolver sobre la marcha", { freeTime: 3, workload: 7, stress: 8 }, "Conservaste flexibilidad, con más presión al acumular pendientes.", "adapt_support"),
  ]),
  event("adapt_support", "adaptation", "Pedir apoyo a tiempo", "Una situación exige más práctica de la esperada y varias entregas se acumulan.", [
    option("ask_support", "Pedir orientación y formar un grupo de apoyo", { energy: 5, stress: -10, professionalNetwork: 5 }, "Abriste espacio para apoyo y aprendizaje compartido.", "__track__", { sought_support: true }),
    option("go_alone", "Intentar resolver todo por tu cuenta", { energy: -7, stress: 8, experience: 2 }, "Ganaste práctica individual, con una carga más intensa.", "__track__", { independent_path: true }),
  ]),
  event("development_opportunity", "development", "Una oportunidad adicional", "Surge una actividad opcional para aplicar lo que estás aprendiendo fuera de tus pendientes habituales.", [
    option("accept", "Participar y ajustar mi organización", { experience: 12, professionalNetwork: 9, freeTime: -10, workload: 7 }, "Elegiste sumar experiencia, con menos tiempo disponible.", "experience_commitment", { has_extra_commitment: true, prioritized_experience: true }),
    option("decline", "Conservar disponibilidad para mi ritmo actual", { energy: 6, freeTime: 8, stress: -5 }, "Protegiste tu disponibilidad y ritmo de adaptación.", "experience_alternative", { protected_time: true }),
  ]),
  event("experience_commitment", "experience", "Equilibrar compromisos", "La actividad adicional coincide con una semana de mayor demanda.", [
    option("coordinate", "Coordinar responsabilidades y pedir ajustes", { stress: -7, professionalNetwork: 6, workload: -4 }, "Reorganizaste compromisos con apoyo de otras personas.", "final_priorities"),
    option("push", "Mantener todo sin ajustar", { energy: -10, stress: 12, experience: 5 }, "Sostuviste el compromiso, con un costo mayor de energía.", "final_priorities"),
  ]),
  event("experience_alternative", "experience", "Construir experiencia a tu ritmo", "Tienes una ventana para elegir una práctica breve o recuperar energía.", [
    option("small_project", "Realizar un proyecto acotado", { experience: 7, professionalNetwork: 4, freeTime: -4 }, "Elegiste una experiencia compatible con tu disponibilidad.", "final_priorities", { built_small_project: true }),
    option("rest", "Recuperar energía y revisar prioridades", { energy: 10, stress: -8, freeTime: 4 }, "Priorizaste recuperar capacidad para lo siguiente.", "final_priorities", { prioritized_rest: true }),
  ]),
  event("final_priorities", "final_stretch", "Cerrar una etapa", "Al acercarte a un cierre, debes definir cómo repartir tu atención.", [
    option("balance", "Distribuir tiempo entre cierre y descanso", { energy: 5, stress: -5, workload: -4 }, "Buscaste un cierre sostenible.", null, { balanced_closure: true }),
    option("focus", "Concentrarme en terminar primero", { experience: 4, workload: -6, freeTime: -6, stress: 3 }, "Priorizaste completar pendientes antes de liberar tiempo.", null, { focused_closure: true }),
  ]),
];

const trackEvents = {
  technology: event("track_technology", "development", "Resolver un problema lógico", "En un proyecto aparece un reto que requiere descomponer un problema y probar alternativas.", [option("prototype", "Probar una solución pequeña y revisar", { experience: 8, stress: -3 }, "Avanzaste con una prueba acotada.", "development_opportunity"), option("document", "Documentar opciones antes de decidir", { workload: 3, professionalNetwork: 4 }, "Priorizaste compartir el razonamiento.", "development_opportunity")], ["technology"]),
  general_academic: event("track_general", "development", "Conectar lo aprendido", "Una actividad te invita a relacionar ideas y explicar tu proceso a otras personas.", [option("share", "Compartir un primer avance", { professionalNetwork: 6, experience: 5, stress: 2 }, "Elegiste aprender con retroalimentación.", "development_opportunity"), option("refine", "Refinar antes de compartir", { workload: 4, experience: 4 }, "Elegiste profundizar antes de mostrar el avance.", "development_opportunity")], ["general_academic"]),
};

for (const [track, title, description] of [["engineering_industry", "Priorizar restricciones", "Un proyecto exige equilibrar calidad, tiempo y recursos disponibles."], ["health_science", "Cuidar el detalle", "Una actividad requiere seguir un procedimiento con atención y organización."], ["design_creative", "Comunicar una idea", "Una propuesta necesita claridad para que otras personas comprendan su intención."], ["business_finance", "Distribuir recursos", "Debes ordenar recursos abstractos limitados entre varias prioridades."], ["social_humanities", "Considerar perspectivas", "Antes de decidir, aparecen puntos de vista distintos que requieren análisis."], ["education", "Adaptar una actividad", "Una actividad debe considerar necesidades de aprendizaje distintas."], ["tourism_gastronomy_service", "Coordinar una experiencia", "Aumenta la demanda y necesitas organizar calidad de atención y tareas."], ["agriculture_environment", "Planificar condiciones", "Debes equilibrar recursos, condiciones ambientales y planificación."]]) trackEvents[track] = event(`track_${track}`, "development", title, description, [option("collaborate", "Organizar una respuesta con otras personas", { professionalNetwork: 6, experience: 5, stress: -2 }, "Priorizaste coordinar y aprender en colaboración.", "development_opportunity"), option("review", "Revisar alternativas antes de actuar", { workload: 3, experience: 6 }, "Priorizaste analizar las alternativas disponibles.", "development_opportunity")], [track]);
Object.freeze(trackEvents);

export function getScenarioForTrack(track) {
  const trackEvent = trackEvents[track] || trackEvents.general_academic;
  return Object.freeze([baseEvents[0], baseEvents[1], trackEvent, ...baseEvents.slice(2)]);
}

export function getEvent(track, eventId) {
  return getScenarioForTrack(track).find((item) => item.id === eventId) || null;
}

export function getTrackEventId(track) { return (trackEvents[track] || trackEvents.general_academic).id; }

export function validateScenarioConfiguration() {
  for (const track of Object.keys(trackEvents)) {
    for (const item of getScenarioForTrack(track)) {
      if (!stages.includes(item.stage) || item.options.length < 2 || item.options.length > 4) throw new Error("Invalid future simulator scenario");
      for (const choice of item.options) if (!choice.id || !choice.label || !choice.explanation) throw new Error("Invalid future simulator option");
    }
  }
  return true;
}

validateScenarioConfiguration();
