import desert from './desert.js';
import city from './city.js';
import mountain from './mountain.js';
import nightcity from './nightcity.js';
import military from './military.js';

export const ENVIRONMENTS = [desert, city, mountain, nightcity, military];
export const ENV_BY_ID = Object.fromEntries(ENVIRONMENTS.map((e) => [e.id, e]));

/** Copy an environment's look (lighting, fog, particle colours, grading) into the project. */
export function applyEnvironmentPreset(project, envId) {
  const env = ENV_BY_ID[envId] || desert;
  const pr = env.preset;
  project.environment.id = env.id;
  Object.assign(project.lighting, pr.lighting);
  project.effects.fog.density = pr.fog.density;
  project.effects.fog.color = pr.fog.color;
  project.effects.particles.dust.color = pr.particles.dust;
  project.effects.particles.smoke.color = pr.particles.smoke;
  Object.assign(project.effects.grading, pr.grading);
}
