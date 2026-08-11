import assert from "node:assert/strict";
import { METRIC_KEYS, SCENARIO_VERSION, getEvent, getScenarioForTrack, getTrackEventId, validateScenarioConfiguration } from "../src/config/futureSimulatorScenarios.js";

assert.equal(SCENARIO_VERSION, 1);
assert.equal(validateScenarioConfiguration(), true);
assert.equal(METRIC_KEYS.length, 7);
for (const track of ["technology", "engineering_industry", "health_science", "design_creative", "business_finance", "social_humanities", "education", "tourism_gastronomy_service", "agriculture_environment", "general_academic"]) {
  const eventId = getTrackEventId(track);
  const item = getEvent(track, eventId);
  assert.ok(item, `missing event for ${track}`);
  assert.ok(item.options.length >= 2 && item.options.length <= 4);
  assert.ok(getScenarioForTrack(track).some((event) => event.id === eventId));
}
const start = getEvent("technology", "start_organize");
assert.equal(start.options.length, 2);
assert.equal(getEvent("technology", "adapt_support").options[0].nextEventId, "__track__");
assert.equal(getEvent("technology", "development_opportunity").options[0].nextEventId, "experience_commitment");
assert.equal(getEvent("technology", "development_opportunity").options[1].nextEventId, "experience_alternative");
assert.equal(getEvent("technology", "final_priorities").options[0].nextEventId, null);
console.log("future simulator scenario tests: 36 passed");
