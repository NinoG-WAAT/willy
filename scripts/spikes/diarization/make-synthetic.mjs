// Spike #104: builds a synthetic French conversation with macOS `say` voices and writes the
// audio plus the exact ground truth (who spoke when). Nothing real is used and nothing is sent
// anywhere: it only runs `say` and `ffmpeg` locally.
//
//   node make-synthetic.mjs --out DIR --name NAME --speakers 3 --seconds 240 --seed 1
//        [--overlap] [--levels] [--pauses]
//
// Writes DIR/NAME.wav (16 kHz mono) and DIR/NAME.truth.json ([{speaker,start,end}] in seconds,
// speech trimmed of the silence TTS adds at both ends; overlaps are real overlaps).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { parseArgs } from "node:util";

const RATE = 16000;
const VOICES = ["Thomas", "Amélie", "Jacques", "Grandma (French (France))"];
// Per-speaker gain (dB) with --levels: people sit at different distances from one laptop mic.
const LEVELS_DB = [0, -4, -8, -11];
// Share of turns per speaker: one dominant voice and one who rarely speaks, as in real meetings.
const WEIGHTS = { 1: [1], 2: [0.55, 0.45], 3: [0.5, 0.35, 0.15], 4: [0.4, 0.3, 0.2, 0.1] };

const SENTENCES = [
  "Bonjour à tous, merci d'être présents pour ce point d'avancement sur le projet.",
  "Je propose que nous commencions par faire le tour des sujets prévus à l'ordre du jour.",
  "Le premier sujet concerne le calendrier de livraison de la nouvelle version du produit.",
  "Nous avons pris du retard sur la partie intégration, principalement à cause de la dépendance externe.",
  "Je pense qu'il faut décaler la date de sortie d'environ deux semaines pour rester prudents.",
  "Le budget prévu pour le trimestre est presque entièrement consommé, il faudra arbitrer.",
  "Est-ce qu'on peut réduire le périmètre de la première version pour tenir la date initiale ?",
  "Les retours des premiers utilisateurs sont plutôt positifs, mais l'écran de réglages les perturbe.",
  "Il faudrait simplifier le parcours d'inscription, car beaucoup de personnes abandonnent à la deuxième étape.",
  "J'ai discuté avec le client hier et il souhaite une démonstration avant la fin du mois.",
  "Pour la démonstration, je peux préparer un scénario court avec les trois fonctions principales.",
  "Nous devons aussi décider qui s'occupe de la documentation pour l'équipe de support.",
  "Je m'en charge, mais j'aurai besoin d'une relecture de la part de quelqu'un de l'équipe technique.",
  "Le test de charge a montré que le service tient mille connexions simultanées sans problème.",
  "En revanche, le temps de réponse se dégrade nettement au-delà de deux mille connexions.",
  "Il faut donc prévoir une optimisation de la base de données avant le lancement public.",
  "Je ne suis pas certain que ce soit la priorité, on a d'autres chantiers plus urgents.",
  "Moi je trouve que la fiabilité passe avant les nouvelles fonctions, surtout pour un premier lancement.",
  "Très bien, alors on note cette décision et on en reparle lors de la prochaine réunion.",
  "Quelqu'un a des informations sur le contrat avec le fournisseur d'hébergement ?",
  "Le contrat se termine en mars, et ils nous ont déjà proposé une augmentation de dix pour cent.",
  "On pourrait comparer avec deux autres fournisseurs avant de renouveler quoi que ce soit.",
  "Je vais demander des devis cette semaine et je vous envoie un tableau comparatif vendredi.",
  "Passons maintenant au recrutement, nous cherchons toujours un développeur expérimenté.",
  "Nous avons reçu une quinzaine de candidatures, dont quatre me semblent vraiment intéressantes.",
  "Les entretiens pourraient avoir lieu la semaine prochaine, si les agendas le permettent.",
  "Je suis disponible mardi et jeudi, mais pas mercredi, j'ai un déplacement à Lyon.",
  "Je propose de regrouper les entretiens sur une seule journée pour gagner du temps.",
  "N'oublions pas de prévenir l'équipe juridique avant de signer quoi que ce soit.",
  "La conformité aux règles de protection des données reste un point d'attention majeur.",
  "Nous avons besoin d'un registre clair de tous les traitements de données personnelles.",
  "Je n'ai pas encore reçu le rapport d'audit, je relance le prestataire dès aujourd'hui.",
  "Cette semaine, j'ai terminé la migration des anciennes données vers le nouveau système.",
  "Quelques erreurs sont apparues sur les dates, je les corrige et je vous tiens au courant.",
  "Pour la communication, nous préparons un article de blog et une courte vidéo de présentation.",
  "L'objectif est de publier le tout le jour du lancement, en même temps que le communiqué.",
  "Il faudrait que chacun relise sa partie avant jeudi soir pour éviter les fautes.",
  "J'ai un doute sur le titre, il me semble un peu trop long pour les réseaux sociaux.",
  "On peut le raccourcir en gardant simplement le nom du produit et la promesse principale.",
  "Je vous propose de terminer avec les actions à mener d'ici la prochaine réunion.",
  "Chacun repart avec ses tâches, et je vous envoie le compte rendu avant demain midi.",
  "Merci beaucoup pour vos contributions, c'était une discussion très constructive.",
];
const SHORT = [
  "Oui.",
  "D'accord.",
  "Exactement.",
  "Pourquoi pas.",
  "Ah bon ?",
  "Très bien.",
  "Tout à fait.",
  "Je suis d'accord.",
  "Bien sûr.",
  "C'est noté.",
  "Non, pas vraiment.",
  "Ça marche.",
  "Voilà.",
  "Effectivement.",
  "Mais oui.",
  "Ah d'accord.",
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Renders one utterance with `say` and returns trimmed 16 kHz mono float samples. */
function render(voice, text, cacheDir) {
  const key = createHash("sha1").update(`${voice}|${text}`).digest("hex");
  const aiff = join(cacheDir, `${key}.aiff`);
  if (!existsSync(aiff)) execFileSync("say", ["-v", voice, "-o", aiff, "--", text]);
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", aiff, "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const f = Float32Array.from(pcm, (v) => v / 32768);
  let lo = 0;
  let hi = f.length - 1;
  while (lo < hi && Math.abs(f[lo]) < 0.004) lo++;
  while (hi > lo && Math.abs(f[hi]) < 0.004) hi--;
  return f.slice(lo, hi + 1);
}

function writeWav(path, samples) {
  const data = Buffer.alloc(samples.length * 2);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0.95 ? 0.95 / peak : 1;
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * norm)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    name: { type: "string" },
    speakers: { type: "string", default: "3" },
    seconds: { type: "string", default: "240" },
    seed: { type: "string", default: "1" },
    overlap: { type: "boolean", default: false },
    levels: { type: "boolean", default: false },
    pauses: { type: "boolean", default: false },
  },
});
if (!values.out || !values.name) {
  process.stderr.write(
    "usage: --out DIR --name NAME [--speakers 2..4 --seconds N --seed N --overlap --levels]\n",
  );
  process.exit(2);
}
const n = Number(values.speakers);
const target = Number(values.seconds);
const rand = rng(Number(values.seed));
mkdirSync(values.out, { recursive: true });
const cacheDir = join(values.out, ".say-cache");
mkdirSync(cacheDir, { recursive: true });

const pick = (list) => list[Math.floor(rand() * list.length)];
const pickSpeaker = (exclude) => {
  const w = WEIGHTS[n].map((x, i) => (i === exclude ? 0 : x));
  const total = w.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < n; i++) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return n - 1;
};
const turnText = () => {
  const r = rand();
  if (r < 0.28) return pick(SHORT);
  if (r < 0.62) return pick(SENTENCES);
  return `${pick(SENTENCES)} ${pick(SENTENCES)}${rand() < 0.4 ? ` ${pick(SENTENCES)}` : ""}`;
};

const placed = []; // {speaker, start (s), samples}
let cursor = 0; // end of the last placed utterance, seconds
let prev = -1;
let order = 0;
// The first utterance is the dominant speaker; after that speakers alternate, never twice in a row.
while (cursor < target) {
  const speaker = order === 0 ? 0 : pickSpeaker(prev);
  const samples = render(VOICES[speaker], turnText(), cacheDir);
  const dur = samples.length / RATE;
  let start;
  if (order === 0) start = 0.4;
  else if (values.overlap && rand() < 0.3)
    start = Math.max(placed.at(-1).start + 0.5, cursor - (0.4 + rand() * 0.9));
  else if (values.pauses && rand() < 0.12) start = cursor + 4 + rand() * 10;
  else start = cursor + 0.15 + rand() * 0.75;
  placed.push({ speaker, start, samples });
  cursor = Math.max(cursor, start + dur);
  // A short interjection that lands inside a long turn (full overlap), only in overlap files.
  if (values.overlap && dur > 6 && rand() < 0.5) {
    let other = pickSpeaker(speaker);
    if (other === speaker) other = (speaker + 1) % n;
    const inter = render(VOICES[other], pick(SHORT), cacheDir);
    placed.push({ speaker: other, start: start + dur * (0.35 + rand() * 0.3), samples: inter });
  }
  prev = speaker;
  order++;
}

const total = Math.ceil(cursor + 0.5) * RATE;
const mix = new Float32Array(total);
const truth = [];
for (const u of placed) {
  const gain = values.levels ? 10 ** (LEVELS_DB[u.speaker] / 20) : 1;
  const off = Math.round(u.start * RATE);
  for (let i = 0; i < u.samples.length; i++) mix[off + i] += u.samples[i] * gain;
  truth.push({
    speaker: `S${u.speaker + 1}`,
    start: +u.start.toFixed(3),
    end: +(u.start + u.samples.length / RATE).toFixed(3),
  });
}
truth.sort((a, b) => a.start - b.start);
writeWav(join(values.out, `${values.name}.wav`), mix);
writeFileSync(join(values.out, `${values.name}.truth.json`), JSON.stringify(truth));
const speech = truth.reduce((a, t) => a + (t.end - t.start), 0);
process.stdout.write(
  `${values.name}: ${(total / RATE).toFixed(1)} s, ${truth.length} utterances, ` +
    `${n} speakers, speech ${speech.toFixed(1)} s, ` +
    `${truth.filter((t) => t.end - t.start < 2).length} short (<2 s)\n`,
);
