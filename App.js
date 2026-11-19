import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Image, ImageBackground, Modal, Switch, KeyboardAvoidingView, useWindowDimensions,
  StyleSheet, SafeAreaView, ScrollView, Alert, Platform, AppState, Animated, Easing, Pressable, StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useKeepAwake } from 'expo-keep-awake';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { IMPOSTOR_CATEGORIES } from './impostorWords';

/* ---------- audio ---------- */
// To change a sound later, just replace the file in assets/audio (keep the same file name).
const MUSIC = {
  main:  { src: require('./assets/audio/the_clue_march.m4a'), vol: 0.5 },  // menus, setup, role handout
  night: { src: require('./assets/audio/night.m4a'),          vol: 0.5 },  // when the game turns to night
  day:   { src: require('./assets/audio/day_strategy.m4a'),   vol: 0.4 },  // when it turns to day (20% quieter)
};
const SOUND_FILES = {
  proceed: require('./assets/audio/proceed.wav'),   // tap that moves the game forward
  deny: require('./assets/audio/deny.wav'),         // tap that cancels / goes back
  killed: require('./assets/audio/killed.wav'),     // someone is killed
  victory: require('./assets/audio/victory.wav'),   // townies win
  villain: require('./assets/audio/villain.wav'),   // villains win
};
const Sound = {
  muted: false,
  wanted: false,        // should music be playing right now?
  track: 'main',        // which music track is current
  lastKilled: 0,
  players: {},
  get(name, src) {
    try {
      if (!this.players[name]) this.players[name] = createAudioPlayer(src);
      return this.players[name];
    } catch (e) { return null; }
  },
  init() { try { setAudioModeAsync({ playsInSilentMode: true }); } catch (e) {} },
  _restart(p) {
    try {
      Promise.resolve(p.seekTo(0)).then(() => p.play()).catch(() => { try { p.play(); } catch (e) {} });
    } catch (e) {}
  },
  play(name) {                       // 'proceed' | 'deny' | 'killed' | 'victory' | 'villain' | 'none'
    if (this.muted || !name || name === 'none' || !SOUND_FILES[name]) return;
    if (name === 'killed') this.lastKilled = Date.now();
    const p = this.get(name, SOUND_FILES[name]);
    if (p) this._restart(p);
  },
  stop(name) { try { if (this.players[name]) this.players[name].pause(); } catch (e) {} },
  pauseAll() {                       // pause every music track (the "wanted" flag is kept)
    Object.keys(this.players).forEach((k) => { if (k.indexOf('music_') === 0) { try { this.players[k].pause(); } catch (e) {} } });
  },
  playMusic() {                      // play / resume the current track
    this.wanted = true;
    if (this.muted) return;
    const t = MUSIC[this.track];
    const p = this.get('music_' + this.track, t.src);
    if (!p) return;
    try { p.loop = true; p.volume = t.vol; p.play(); } catch (e) {}
  },
  pauseMusic() { this.wanted = false; this.pauseAll(); },
  setTrack(name) {                   // switch to another track, starting from the beginning
    if (this.track === name && this.wanted) return;
    this.pauseAll();
    this.track = name;
    const p = this.get('music_' + name, MUSIC[name].src);
    try { if (p) p.seekTo(0); } catch (e) {}
    this.playMusic();
  },
  setMuted(m) {
    this.muted = m;
    if (m) this.pauseAll();
    else if (this.wanted) this.playMusic();
  },
};

/* ---------- pictures (put your own files in assets/roles, same file names) ---------- */
const WALLPAPER = require('./assets/anaxios-main-wallpaper.jpg');
const ROLE_ASSETS = {
  villager: require('./assets/roles/villager.png'),
  doctor: require('./assets/roles/doctor.png'),
  jester: require('./assets/roles/jester.png'),
  avenger: require('./assets/roles/avenger.png'),
  werewolf: require('./assets/roles/werewolf.png'),
  police: require('./assets/roles/police.png'),
  mayor: require('./assets/roles/mayor.png'),
  hunter: require('./assets/roles/hunter.png'),
  vampire: require('./assets/roles/vampire.png'),
  bodyguard: require('./assets/roles/bodyguard.png'),
  seer: require('./assets/roles/seer.png'),
  transporter: require('./assets/roles/transporter.png'),
  veteran: require('./assets/roles/veteran.png'),               // placeholder art
  executioner: require('./assets/roles/executioner.png'),       // placeholder art
  retributionist: require('./assets/roles/retributionist.png'), // placeholder art
  hexer: require('./assets/roles/hexer.png'),                   // placeholder art
  default: require('./assets/roles/default.png'), // used for custom roles without a picture
};

/* ---------- constants & helpers ---------- */
const PLAYERS_KEY = 'ww_players_v1';
const ROLES_KEY = 'ww_roles_v1';
const SEED_KEY = 'ww_roles_seed_v3';
const PSEED_KEY = 'ww_players_seed_v1';
const SEED4_KEY = 'ww_roles_seed_v4';
const MUTE_KEY = 'ww_muted_v1';
const SEED5_KEY = 'ww_roles_seed_v5';
const SEED6_KEY = 'ww_roles_seed_v6';
const SEED7_KEY = 'ww_roles_seed_v7';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// hasAction = wakes up at night. order = who is called first (lower = earlier).
// targets = how many players the role picks each night.
// Extra per-role options (all editable in Available Roles):
//   uses = how many times the night power can be used per game (0 = unlimited)
//   startNight = first night the power can be used
//   actsWhenDead = the power is used after the player has died (Avenger)
//   selfAction = no player is chosen, the moderator only asks "use it or not?" (Veteran alert)
//   targetDead = the power is aimed at a dead player (Retributionist)
//   winOnVote = shares the win with the winning team if this player is voted out (Jester)
//   winOnTarget = shares the win with the winning team if its random target is voted out (Executioner)
// Rating points a player gains when their role wins (editable per role in Available Roles).
const BASE_GAIN = { villager: 15, doctor: 15, jester: 40, avenger: 15, werewolf: 25, police: 15, mayor: 15, hunter: 15, vampire: 10, bodyguard: 15, seer: 15, transporter: 15, veteran: 15, executioner: 30, retributionist: 15, hexer: 15 };
const OLD_GAIN = { villager: 10, doctor: 10, jester: 30, avenger: 10, werewolf: 20, police: 10, mayor: 10, hunter: 10, vampire: 8, bodyguard: 10, seer: 10, transporter: 10 };
const OLD_ORDER = { police: 1, transporter: 2, werewolf: 3, vampire: 4, bodyguard: 5, doctor: 6, seer: 7 };
const mk = (id, name, team, emoji, hasAction, order, targets, nightPrompt, desc, extra = {}) => ({
  id, name, team, emoji, icon: null, builtIn: true, hasAction, order, targets, nightPrompt, desc,
  canTargetSame: team !== 'Villain',
  ratingGain: BASE_GAIN[id] ?? 10,
  winOnVote: id === 'jester',
  winOnTarget: false, uses: 0, startNight: 1, actsWhenDead: false, selfAction: false, targetDead: false,
  ...extra,
});
const DEFAULT_ROLES = [
  mk('villager', 'Villager', 'Townie', '🧑‍🌾', false, 50, 1, '',
    'An ordinary townsperson with no special power. Find the werewolves and vote them out.'),
  mk('doctor', 'Doctor', 'Townie', '🩺', true, 9, 1, 'Doctor, wake up. Who do you want to protect tonight?',
    'Each night, choose one player to protect from the werewolves.'),
  mk('jester', 'Jester', 'Townie', '🃏', false, 50, 1, '',
    'You want to be voted out! If the town votes you out you win — together with whichever team wins the game.'),
  mk('avenger', 'Avenger', 'Townie', '🗡️', true, 12, 1, 'Avenger, wake up. You are dead — who do you want to take down with you?',
    'After you die, on the next night you may choose one player to kill. This can be done only once.',
    { uses: 1, actsWhenDead: true, canTargetSame: false }),
  mk('werewolf', 'Werewolf', 'Villain', '🐺', true, 4, 1, 'Werewolves, wake up. Who do you want to eliminate tonight?',
    'Each night, the werewolves agree on one player to eliminate. Blend in during the day.'),
  mk('police', 'Police', 'Townie', '👮', true, 2, 1, 'Police, wake up. Who do you want to silence tomorrow?',
    'Each night, choose one player to silence. That player is not allowed to talk during the next day.'),
  mk('mayor', 'Mayor', 'Townie', '🎩', false, 50, 1, '',
    'Your vote counts as two votes during the day discussion and voting.'),
  mk('hunter', 'Hunter', 'Townie', '🤠', true, 7, 1, 'Hunter, wake up. Who do you want to shoot tonight?',
    'Every night you can choose a player to kill. If you hit a Vampire you succeed. If you hit a Townie, you die the next night.',
    { canTargetSame: false }),
  mk('vampire', 'Vampire', 'Villain', '🧛', true, 5, 1, 'Vampire, wake up. Who do you want to bite tonight?',
    'Each night, bite one player to turn them into a vampire. Bitten players become your villain allies.'),
  mk('bodyguard', 'Bodyguard', 'Townie', '🕶️', true, 8, 1, 'Bodyguard, wake up. Who do you want to guard tonight?',
    'Each night, guard one player. If the werewolves attack them, you die in their place.'),
  mk('seer', 'Seer', 'Townie', '🔮', true, 11, 1, 'Seer, wake up. Who do you want to check tonight?',
    'Each night, point at a player and the moderator tells you if they are a villain.'),
  mk('transporter', 'Transporter', 'Townie', '🌀', true, 3, 2, 'Transporter, wake up. Which two players do you want to swap tonight?',
    'Each night, choose two players to swap places. Any night action aimed at one hits the other instead.'),
  mk('veteran', 'Veteran', 'Townie', '💂', true, 1, 1, 'Veteran, wake up. Do you want to go on alert tonight?',
    'You can stay alert once. While on alert, any player who visits you that night will die. This can be done only once.',
    { selfAction: true, uses: 1 }),
  mk('executioner', 'Executioner', 'Townie', '⚔️', false, 50, 1, '',
    'You get a random target who must be voted out. If your target is voted out, you win (together with the winning team). If your target is killed at night, you become a Villager.',
    { winOnTarget: true }),
  mk('retributionist', 'Retributionist', 'Townie', '🪦', true, 10, 1, 'Retributionist, wake up. Which dead player do you want to bring back to life?',
    'At night you can bring back to life a player who was voted out or killed, of your choice. This can be done only once.',
    { targetDead: true, uses: 1 }),
  mk('hexer', 'Hexer', 'Townie', '🧪', true, 6, 1, 'Hexer, wake up. Who do you want to hex tonight?',
    'From the second night on, choose a player to cure of vampirism. If they are a Vampire they become a Villager. Can be used twice, once per night.',
    { startNight: 2, uses: 2 }),
];

// Makes roles saved by an older version of the app compatible (adds the new fields).
const normalizeRoles = (saved) => {
  const defaults = {};
  DEFAULT_ROLES.forEach((r) => (defaults[r.id] = r));
  return saved.map((r) => {
    const d = defaults[r.id];
    const base = d ? { ...d } : { hasAction: false, order: 50, targets: 1, nightPrompt: '', canTargetSame: true, ratingGain: 10, winOnVote: false, winOnTarget: false, uses: 0, startNight: 1, actsWhenDead: false, selfAction: false, targetDead: false };
    return { ...base, ...r };
  });
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Suggested role counts for n players
const suggestCounts = (n, roles) => {
  const c = {};
  roles.forEach((r) => (c[r.id] = 0));
  const has = (id) => roles.some((r) => r.id === id);
  let left = n;
  const put = (id, k) => { if (has(id) && k > 0 && left > 0) { const t = Math.min(k, left); c[id] += t; left -= t; } };
  const wolfId = has('werewolf') ? 'werewolf' : (roles.find((r) => r.team === 'Villain') || {}).id;
  if (wolfId) put(wolfId, Math.max(1, Math.round(n / 4)));
  if (n >= 5) put('seer', 1);
  if (n >= 5) put('doctor', 1);
  if (n >= 8) put('avenger', 1);
  if (has('villager')) c.villager += left; else if (roles[0]) c[roles[0].id] += left;
  return c;
};

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const pickImage = async () => {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) { Alert.alert('Permission needed', 'Please allow photo access.'); return null; }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5,
  });
  return res.canceled ? null : res.assets[0].uri;
};

// Builds the list of roles the moderator must wake up tonight.
// A holder is included when: the role has a night action, the holder is alive (or dead for "acts when dead" roles like the
// Avenger), has uses left, it is late enough in the game, and (for "picks a dead player" roles) someone has died.
const buildNightSteps = (assignments, night) => {
  const anyDead = assignments.some((a) => !a.alive);
  const map = {};
  assignments.forEach((a) => {
    const r = a.role;
    if (!r.hasAction || a.doomed) return;
    if (r.actsWhenDead ? a.alive : !a.alive) return;
    if (r.uses > 0 && (a.used || 0) >= r.uses) return;
    if (night < (r.startNight || 1)) return;
    if (r.targetDead && !anyDead) return;
    if (!map[r.id]) map[r.id] = { role: r, holders: [] };
    map[r.id].holders.push(a.player);
  });
  return Object.values(map).sort((x, y) => (x.role.order ?? 50) - (y.role.order ?? 50));
};

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Works out everything that happens during a night. Pure function: returns the new assignments + a list of events
// for the moderator's summary. actions = { roleId: [playerId] | ['none'] | ['self'] }.
const resolveNight = (assignments, steps, actions, villagerRole) => {
  const A = assignments.map((a) => ({ ...a }));
  const events = [];            // { kind: 'death' | 'info', text }
  const dead = new Set();       // players who die tonight
  const revived = [];
  const byId = (id) => A.find((a) => a.player.id === id);
  const nm = (id) => (byId(id) ? byId(id).player.name : '?');
  const stepOf = (rid) => steps.find((st) => st.role.id === rid);
  const picks = (rid) => (actions[rid] || []).filter((x) => x !== 'none');
  const kill = (id, text) => { if (dead.has(id)) return; dead.add(id); events.push({ kind: 'death', text }); };
  const info = (text) => events.push({ kind: 'info', text });

  // Transporter swaps the targets of the other roles
  const sw = picks('transporter');
  const swapOn = !!stepOf('transporter') && sw.length === 2;
  const swap = (id) => (!swapOn ? id : id === sw[0] ? sw[1] : id === sw[1] ? sw[0] : id);
  const tgt = (rid) => { const p = picks(rid); return p.length && p[0] !== 'self' ? swap(p[0]) : null; };
  if (swapOn) info(`🌀 ${nm(sw[0])} and ${nm(sw[1])} were swapped.`);

  // A Hunter who shot a Townie last night dies of guilt
  A.filter((a) => a.alive && a.doomed).forEach((a) => kill(a.player.id, `🕯️ ${a.player.name} (${a.role.name}) died of guilt for shooting a Townie.`));

  // Veteran on alert: every visitor dies (one holder of each visiting role), and the Veteran survives attacks
  const alertVets = new Set();
  if (stepOf('veteran') && picks('veteran').includes('self')) {
    stepOf('veteran').holders.forEach((h) => alertVets.add(h.id));
    info('🛡️ The Veteran is on alert tonight.');
  }
  steps.forEach((st) => {
    const rid = st.role.id;
    if (rid === 'transporter' || rid === 'veteran') return;
    const t = rid === 'retributionist' ? picks(rid)[0] : tgt(rid);
    if (!t || !alertVets.has(t)) return;
    const holders = st.holders.filter((h) => byId(h.id).alive && !dead.has(h.id));
    if (holders.length) { const v = rnd(holders); kill(v.id, `💀 ${v.name} (${st.role.name}) visited the alert Veteran and died.`); }
  });

  // Attacks: Werewolves, Hunter and the dead Avenger. The Doctor saves, the alert Veteran is immune.
  const doc = tgt('doctor');
  const guardTarget = tgt('bodyguard');
  const guard = A.find((a) => a.alive && a.role.id === 'bodyguard');
  const attack = (id, label, kind) => {
    if (!id) return false;
    const t = byId(id);
    if (!t || !t.alive || dead.has(id)) return false;
    if (alertVets.has(id)) { info(`🛡️ The ${label} attack on ${t.player.name} failed — the Veteran was on alert.`); return false; }
    if (doc === id) { info(`🩺 The Doctor saved ${t.player.name} from the ${label}.`); return false; }
    if (kind === 'werewolf' && guardTarget === id && guard && !dead.has(guard.player.id)) {
      kill(guard.player.id, `🛡️ ${guard.player.name} (Bodyguard) died protecting ${t.player.name}.`);
      return false;
    }
    kill(id, `💀 ${t.player.name} was killed by the ${label}.`);
    return true;
  };
  attack(tgt('werewolf'), 'werewolves', 'werewolf');
  const shotId = tgt('hunter');
  if (attack(shotId, 'Hunter', 'hunter') && byId(shotId).role.team === 'Townie') {
    const hh = byId(stepOf('hunter').holders[0].id);
    hh.doomed = true;
    info(`🕯️ ${hh.player.name} (Hunter) shot a Townie and will die next night.`);
  }
  attack(tgt('avenger'), 'Avenger', 'avenger');

  // Hexer cures a Vampire (becomes a Villager). This happens before the bite.
  const hexId = tgt('hexer');
  if (hexId) {
    const t = byId(hexId);
    if (t && t.alive && !dead.has(hexId) && t.role.id === 'vampire') {
      t.role = villagerRole;
      info(`🧪 ${t.player.name} was a Vampire — now a Villager.`);
    } else if (t) info(`🧪 ${t.player.name} is not a Vampire — the hex had no effect.`);
  }

  // Vampire bite
  const vStep = stepOf('vampire');
  const biteId = tgt('vampire');
  if (vStep && biteId) {
    const t = byId(biteId);
    const stillVamp = vStep.holders.some((h) => byId(h.id).alive && !dead.has(h.id) && byId(h.id).role.id === 'vampire');
    if (stillVamp && t && t.alive && !dead.has(biteId) && t.role.team !== 'Villain' && !alertVets.has(biteId)) {
      t.role = vStep.role;
      info(`🧛 ${t.player.name} was bitten and becomes a Vampire — tell them secretly.`);
    }
  }

  // Retributionist revives a dead player
  const retId = picks('retributionist')[0];
  if (retId) {
    const t = byId(retId);
    if (t && !t.alive) { t.alive = true; t.votedOut = false; t.doomed = false; revived.push(retId); info(`✨ ${t.player.name} will be brought back to life.`); }
  }

  // Powers with limited uses are used up
  steps.forEach((st) => {
    if (!(st.role.uses > 0)) return;
    if ((actions[st.role.id] || []).some((x) => x !== 'none')) st.holders.forEach((h) => { const x = byId(h.id); x.used = (x.used || 0) + 1; });
  });

  // Executioner: if the target dies at night (not by a vote) the Executioner becomes a Villager
  A.forEach((a) => {
    if (a.role.winOnTarget && !a.won && a.target && dead.has(a.target)) {
      info(`⚔️ ${a.player.name}'s target (${nm(a.target)}) died at night — the Executioner becomes a Villager.`);
      a.role = villagerRole;
    }
  });

  dead.forEach((id) => { const a = byId(id); a.alive = false; a.votedOut = false; });
  return { assignments: A, events, deaths: [...dead], revived };
};

/* ---------- animation helpers (built-in Animated API, no extra packages) ---------- */
// slides + fades its content in when it appears
const FadeUp = ({ delay = 0, dx = 0, dy = 18, duration = 380, style, children }) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[{ alignItems: 'center' }, style, {
      opacity: v,
      transform: [
        { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [dx, 0] }) },
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) },
      ],
    }]}>{children}</Animated.View>
  );
};

// pops in with a springy overshoot
const PopIn = ({ delay = 0, from = 0.3, style, children }) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true })]).start();
  }, []);
  return (
    <Animated.View style={[{ alignItems: 'center' }, style, {
      opacity: v.interpolate({ inputRange: [0, 0.4], outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }],
    }]}>{children}</Animated.View>
  );
};

// card-flip + pop (used when a role is revealed)
const FlipIn = ({ delay = 0, style, children }) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true })]).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: v.interpolate({ inputRange: [0, 0.25], outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [
        { perspective: 900 },
        { rotateY: v.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '0deg'] }) },
        { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
      ],
    }]}>{children}</Animated.View>
  );
};

// small bounce every time `trigger` changes (selecting a card, changing a counter)
const Bounce = ({ trigger, style, children }) => {
  const v = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    Animated.sequence([
      Animated.timing(v, { toValue: 1.09, duration: 110, useNativeDriver: true }),
      Animated.spring(v, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [trigger]);
  return <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>;
};

// gentle floating up/down
const Bob = ({ amount = 7, duration = 1000, style, children }) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return <Animated.View style={[style, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -amount] }) }] }]}>{children}</Animated.View>;
};

// pulsing glow behind an image
const Glow = ({ color, size }) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.45] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }],
    }} />
  );
};

// emoji sparkles flying outward once
const Burst = ({ emoji = '✨', count = 8, radius = 105 }) => {
  const vals = useRef(Array.from({ length: count }, () => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(45, vals.map((v) => Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }))).start();
  }, []);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, alignItems: 'center', justifyContent: 'center' }}>
      {vals.map((v, i) => {
        const ang = (i / count) * Math.PI * 2;
        return (
          <Animated.Text key={i} style={{
            position: 'absolute', fontSize: 22,
            opacity: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
            transform: [
              { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(ang) * radius] }) },
              { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(ang) * radius] }) },
              { scale: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 1.2, 0.6] }) },
            ],
          }}>{emoji}</Animated.Text>
        );
      })}
    </View>
  );
};

// every screen fades / slides in when it opens
const Screen = ({ children }) => <FadeUp dy={14} duration={260} style={{ flex: 1, alignItems: 'stretch' }}>{children}</FadeUp>;

const APressable = Animated.createAnimatedComponent(Pressable);

/* ---------- small UI pieces ---------- */
// sfx: 'proceed' (default) | 'deny' (cancel / back) | 'none'.  Buttons squish a little when pressed.
const Btn = ({ title, onPress, kind = 'primary', disabled, style, sfx = 'proceed' }) => {
  const sc = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(sc, { toValue: v, friction: 6, tension: 220, useNativeDriver: true }).start();
  return (
    <APressable
      onPress={() => { Sound.play(sfx); if (onPress) onPress(); }}
      onPressIn={() => to(0.95)} onPressOut={() => to(1)} disabled={disabled}
      style={[s.btn, kind === 'ghost' && s.btnGhost, kind === 'danger' && s.btnDanger, disabled && { opacity: 0.4 }, style, { transform: [{ scale: sc }] }]}>
      <Text style={s.btnText}>{title}</Text>
    </APressable>
  );
};

const Avatar = ({ uri, fallback, size = 48 }) =>
  uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#333' }} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#2d2f45', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.5, color: '#fff' }}>{fallback}</Text>
    </View>
  );

// Role picture: your uploaded picture > built-in role picture > generic default.png
const RoleAvatar = ({ role, size = 48 }) => {
  const r = size * 0.22;
  if (role.icon) return <Image source={{ uri: role.icon }} style={{ width: size, height: size, borderRadius: r, backgroundColor: '#333' }} />;
  if (ROLE_ASSETS[role.id]) return <Image source={ROLE_ASSETS[role.id]} resizeMode="contain" style={{ width: size, height: size }} />;
  return <Image source={ROLE_ASSETS.default} resizeMode="contain" style={{ width: size, height: size }} />;
};

const Tag = ({ team }) => (
  <View style={[s.tag, { backgroundColor: team === 'Villain' ? '#7a1f2b' : '#1f6b4a' }]}>
    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{team}</Text>
  </View>
);

const Header = ({ title, onBack, right }) => (
  <View style={s.header}>
    {onBack ? <TouchableOpacity onPress={() => { Sound.play('deny'); onBack(); }} style={{ width: 60 }}><Text style={s.link}>‹ Back</Text></TouchableOpacity> : <View style={{ width: 60 }} />}
    <Text style={s.title}>{title}</Text>
    <View style={{ width: 60, alignItems: 'flex-end' }}>{right}</View>
  </View>
);

/* ---------- main app ---------- */
export default function App() {
  const [screen, setScreen] = useState('home');
  const [players, setPlayers] = useState([]);
  const [roles, setRoles] = useState(DEFAULT_ROLES);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState({});   // playerId -> true
  const [counts, setCounts] = useState({});
  const [game, setGame] = useState(null);         // { assignments: [{player, role, alive}] }
  const [muted, setMuted] = useState(false);
  // Impostor game settings + current round
  const [customWords, setCustomWords] = useState([]);
  const [imp, setImp] = useState({ cats: {}, count: 1, hints: 3, seeMates: false, deal: null });
  const seenWords = useRef(new Set());   // words already used this session (avoids repeats)

  useEffect(() => {
    (async () => {
      try {
        const mu = await AsyncStorage.getItem(MUTE_KEY);
        Sound.setMuted(mu === '1'); setMuted(mu === '1');
        try {
          const cw = await AsyncStorage.getItem(IMP_CUSTOM_KEY);
          if (cw) setCustomWords(JSON.parse(cw));
          else {   // old version stored plain words without hints: keep them as incomplete entries so they can be finished
            const old = await AsyncStorage.getItem(IMP_CUSTOM_OLD);
            if (old) setCustomWords(JSON.parse(old).map((w) => ({ id: uid(), w, h: ['', '', ''] })));
          }
        } catch (e) {}
        const p = await AsyncStorage.getItem(PLAYERS_KEY);
        const r = await AsyncStorage.getItem(ROLES_KEY);
        let plist = p ? JSON.parse(p) : [];
        const pSeeded = await AsyncStorage.getItem(PSEED_KEY);
        if (!pSeeded) {
          // first launch: start with 4 default players
          if (plist.length === 0) plist = [1, 2, 3, 4].map((n) => ({ id: `default-${n}`, name: `Player ${n}`, photo: null }));
          await AsyncStorage.setItem(PSEED_KEY, '1');
        }
        setPlayers(plist);
        let list = r ? normalizeRoles(JSON.parse(r)) : DEFAULT_ROLES;
        const seeded = await AsyncStorage.getItem(SEED_KEY);
        if (!seeded) {
          // one-time: add the new default roles to an existing library and refresh built-in night order
          const defs = {};
          DEFAULT_ROLES.forEach((d) => (defs[d.id] = d));
          const have = new Set(list.map((x) => x.id));
          list = list.map((x) => (defs[x.id] && x.builtIn ? { ...x, order: defs[x.id].order } : x));
          DEFAULT_ROLES.forEach((d) => { if (!have.has(d.id)) list.push(d); });
          await AsyncStorage.setItem(SEED_KEY, '1');
        }
        const seeded4 = await AsyncStorage.getItem(SEED4_KEY);
        if (!seeded4) {
          const fix = {};
          DEFAULT_ROLES.filter((d) => d.id === 'police' || d.id === 'vampire').forEach((d) => (fix[d.id] = d));
          list = list.map((x) => (fix[x.id] && x.builtIn ? { ...x, desc: fix[x.id].desc, nightPrompt: fix[x.id].nightPrompt } : x));
          await AsyncStorage.setItem(SEED4_KEY, '1');
        }
        const seeded5 = await AsyncStorage.getItem(SEED5_KEY);
        if (!seeded5) {   // one-time: new Jester description
          const jd = DEFAULT_ROLES.find((d) => d.id === 'jester');
          list = list.map((x) => (x.id === 'jester' && x.builtIn ? { ...x, desc: jd.desc } : x));
          await AsyncStorage.setItem(SEED5_KEY, '1');
        }
        const seeded6 = await AsyncStorage.getItem(SEED6_KEY);
        if (!seeded6) {   // one-time: move built-in roles from the old default gains to the new ones (your own edits are kept)
          list = list.map((x) => (x.builtIn && BASE_GAIN[x.id] != null && (x.ratingGain == null || x.ratingGain === OLD_GAIN[x.id]) ? { ...x, ratingGain: BASE_GAIN[x.id] } : x));
          await AsyncStorage.setItem(SEED6_KEY, '1');
        }
        const seeded7 = await AsyncStorage.getItem(SEED7_KEY);
        if (!seeded7) {   // one-time: new Hunter / Avenger / Jester rules, new night order, and the 4 new roles
          const defs = {};
          DEFAULT_ROLES.forEach((d) => (defs[d.id] = d));
          const have = new Set(list.map((x) => x.id));
          const redo = ['hunter', 'avenger', 'jester'];
          list = list.map((x) => {
            const d = defs[x.id];
            if (!d || !x.builtIn) return x;
            if (redo.includes(x.id)) return { ...d, icon: x.icon || null, ratingGain: x.ratingGain ?? d.ratingGain };
            if (x.order === OLD_ORDER[x.id]) return { ...x, order: d.order };
            return x;
          });
          DEFAULT_ROLES.forEach((d) => { if (!have.has(d.id)) list.push(d); });
          await AsyncStorage.setItem(SEED7_KEY, '1');
        }
        setRoles(list);
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);
  // background music: starts when the app is ready, pauses while the app is in the background
  useEffect(() => {
    if (!loaded) return undefined;
    Sound.init();
    Sound.playMusic();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { if (Sound.wanted && !Sound.muted) Sound.playMusic(); }
      else Sound.pauseAll();
    });
    return () => sub.remove();
  }, [loaded]);
  // rating only ever goes up: gains = { playerId: points }
  const awardGains = (gains) => setPlayers((ps) => ps.map((p) => (gains[p.id] ? { ...p, rating: (p.rating || 0) + gains[p.id] } : p)));
  const toggleMute = () => {
    const m = !muted;
    setMuted(m); Sound.setMuted(m);
    AsyncStorage.setItem(MUTE_KEY, m ? '1' : '0').catch(() => {});
  };
  useEffect(() => { if (loaded) AsyncStorage.setItem(PLAYERS_KEY, JSON.stringify(players)).catch(() => {}); }, [players, loaded]);
  useEffect(() => { if (loaded) AsyncStorage.setItem(ROLES_KEY, JSON.stringify(roles)).catch(() => {}); }, [roles, loaded]);

  const selectedPlayers = useMemo(() => players.filter((p) => selected[p.id]), [players, selected]);

  const saveCustom = (list) => { setCustomWords(list); AsyncStorage.setItem(IMP_CUSTOM_KEY, JSON.stringify(list)).catch(() => {}); };
  // picks a random word from the chosen categories and decides who the impostors are
  const dealImpostor = () => {
    const pool = [];
    const mine = customWords.filter(isCompleteEntry).map((e) => ({ w: e.w.trim(), h: e.h.map((x) => x.trim()) }));
    [...IMPOSTOR_CATEGORIES, { ...CUSTOM_CAT, words: mine }].forEach((c) => {
      if (imp.cats[c.id]) c.words.forEach((x) => pool.push({ word: x.w, hints: x.h, category: c.name }));
    });
    if (!pool.length || selectedPlayers.length === 0) return null;
    let fresh = pool.filter((x) => !seenWords.current.has(x.word));
    if (!fresh.length) { seenWords.current.clear(); fresh = pool; }
    const pick = fresh[Math.floor(Math.random() * fresh.length)];
    seenWords.current.add(pick.word);
    const impIds = new Set(shuffle(selectedPlayers).slice(0, Math.min(imp.count, selectedPlayers.length)).map((p) => p.id));
    // every impostor gets their own random set of hints
    return {
      word: pick.word, category: pick.category, seeMates: imp.seeMates, clockwise: Math.random() < 0.5,
      cards: selectedPlayers.map((p) => {
        const isImp = impIds.has(p.id);
        return { player: p, impostor: isImp, hints: isImp ? shuffle(pick.hints).slice(0, Math.min(imp.hints, pick.hints.length)) : [] };
      }),
      first: selectedPlayers[Math.floor(Math.random() * selectedPlayers.length)],
    };
  };
  const startImpostor = () => { const d = dealImpostor(); if (d) { setImp({ ...imp, deal: d }); setScreen('imp-reveal'); } };

  let body = null;
  if (!loaded) body = <View style={s.center}><Text style={s.sub}>Loading…</Text></View>;
  else if (screen === 'home') body = <Home go={setScreen} onNew={() => { setSelected({}); setScreen('pick'); }} onImpostor={() => { setSelected({}); setScreen('imp-pick'); }} muted={muted} onToggleMute={toggleMute} />;
  else if (screen === 'library') body = <Library players={players} setPlayers={setPlayers} onBack={() => setScreen('home')} />;
  else if (screen === 'roles') body = <Roles roles={roles} setRoles={setRoles} onBack={() => setScreen('home')} />;
  else if (screen === 'pick') body = (
    <PickPlayers players={players} selected={selected} setSelected={setSelected}
      onBack={() => setScreen('home')}
      onNext={() => { setCounts(suggestCounts(selectedPlayers.length, roles)); setScreen('assign'); }}
      goLibrary={() => setScreen('library')} />
  );
  else if (screen === 'assign') body = (
    <AssignRoles roles={roles} counts={counts} setCounts={setCounts} total={selectedPlayers.length}
      onBack={() => setScreen('pick')}
      onReset={() => setCounts(suggestCounts(selectedPlayers.length, roles))}
      onStart={() => {
        const pool = [];
        roles.forEach((r) => { for (let i = 0; i < (counts[r.id] || 0); i++) pool.push(r); });
        const shuffled = shuffle(pool);
        const asg = selectedPlayers.map((p, i) => ({ player: p, role: shuffled[i], alive: true }));
        // an Executioner gets a random target (any other player)
        const withTargets = asg.map((a) => {
          if (!a.role.winOnTarget) return a;
          const others = asg.filter((x) => x.player.id !== a.player.id);
          return others.length ? { ...a, target: others[Math.floor(Math.random() * others.length)].player.id } : a;
        });
        setGame({ assignments: withTargets });
        setScreen('reveal');
      }} />
  );
  else if (screen === 'reveal' && game) body = (
    <RevealRoles game={game}
      onCancel={() => { setGame(null); setScreen('assign'); }}
      onDone={() => setScreen('game')} />
  );
  else if (screen === 'imp-pick') body = (
    <PickPlayers title="Impostor – Players" min={3} players={players} selected={selected} setSelected={setSelected}
      onBack={() => setScreen('home')}
      onNext={() => { setImp({ ...imp, count: Math.min(Math.max(1, imp.count), selectedPlayers.length) }); setScreen('imp-cat'); }}
      goLibrary={() => setScreen('library')} />
  );
  else if (screen === 'imp-cat') body = (
    <ImpCategories custom={customWords} picked={imp.cats} setPicked={(m) => setImp({ ...imp, cats: m })} onSaveCustom={saveCustom}
      onBack={() => setScreen('imp-pick')} onNext={() => setScreen('imp-setup')} />
  );
  else if (screen === 'imp-setup') body = (
    <ImpSetup n={selectedPlayers.length} count={Math.min(imp.count, selectedPlayers.length)} setCount={(c) => setImp({ ...imp, count: c })}
      hints={imp.hints} setHints={(v) => setImp({ ...imp, hints: v })} seeMates={imp.seeMates} setSeeMates={(v) => setImp({ ...imp, seeMates: v })}
      onBack={() => setScreen('imp-cat')} onStart={startImpostor} />
  );
  else if (screen === 'imp-reveal' && imp.deal) body = (
    <ImpReveal deal={imp.deal} onCancel={() => setScreen('imp-setup')} onDone={() => setScreen('imp-play')} />
  );
  else if (screen === 'imp-play' && imp.deal) body = (
    <ImpPlay deal={imp.deal} onAgain={startImpostor} onSettings={() => setScreen('imp-setup')} onExit={() => { setImp({ ...imp, deal: null }); setScreen('home'); }} />
  );
  else if (screen === 'game' && game) body = <Game game={game} setGame={setGame} roles={roles} onExit={() => { setGame(null); setScreen('home'); }} onRematch={() => { setGame(null); setScreen('assign'); }} onAward={awardGains} />;

  if (loaded && screen === 'home') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <StatusBar style="light" translucent />
        <Screen key={screen + loaded}>{body}</Screen>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      <Screen key={screen + loaded}>{body}</Screen>
    </SafeAreaView>
  );
}

/* ---------- home ---------- */
function Home({ go, onNew, onImpostor, muted, onToggleMute }) {
  const zoom = useRef(new Animated.Value(0)).current;
  useEffect(() => {   // slow "breathing" zoom on the wallpaper
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(zoom, { toValue: 1, duration: 12000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(zoom, { toValue: 0, duration: 12000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={{ flex: 1, overflow: 'hidden', backgroundColor: '#000' }}>
      <Animated.Image source={WALLPAPER} resizeMode="cover"
        style={[StyleSheet.absoluteFill, { width: undefined, height: undefined, transform: [{ scale: zoom.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) }] }]} />
      <TouchableOpacity onPress={onToggleMute} style={s.muteBtn} activeOpacity={0.8}>
        <Text style={{ fontSize: 20 }}>{muted ? '🔇' : '🔊'}</Text>
      </TouchableOpacity>
      <View style={{ flex: 1, justifyContent: 'flex-end', padding: 20, paddingBottom: Platform.OS === 'ios' ? 194 : 178 }}>
        <View>
          <FadeUp delay={150} dy={30} style={{ alignItems: 'stretch' }}><Btn title="New Game" onPress={onNew} style={[s.wide, { backgroundColor: '#e0952b' }]} /></FadeUp>
          <FadeUp delay={300} dy={30} style={{ alignItems: 'stretch' }}><Btn title="Players Library" kind="ghost" onPress={() => go('library')} style={[s.wide, s.menuGhost]} /></FadeUp>
          <FadeUp delay={450} dy={30} style={{ alignItems: 'stretch' }}><Btn title="Available Roles" kind="ghost" onPress={() => go('roles')} style={[s.wide, s.menuGhost]} /></FadeUp>
          <FadeUp delay={600} dy={30} style={{ alignItems: 'stretch' }}><Btn title="Impostor" onPress={onImpostor} style={[s.wide, { backgroundColor: '#b3303f', marginBottom: 0 }]} /></FadeUp>
        </View>
      </View>
    </View>
  );
}

/* ---------- players library ---------- */
function Library({ players, setPlayers, onBack }) {
  const [editing, setEditing] = useState(null); // {id?, name, photo}
  const save = () => {
    const name = editing.name.trim();
    if (!name) return Alert.alert('Name required');
    if (editing.id) setPlayers(players.map((p) => (p.id === editing.id ? { ...p, name, photo: editing.photo } : p)));
    else setPlayers([...players, { id: uid(), name, photo: editing.photo }]);
    setEditing(null);
  };
  const remove = (p) => Alert.alert('Delete player', `Remove ${p.name}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => setPlayers(players.filter((x) => x.id !== p.id)) },
  ]);
  return (
    <View style={{ flex: 1 }}>
      <Header title="Players Library" onBack={onBack} right={<TouchableOpacity onPress={() => setEditing({ name: '', photo: null })}><Text style={s.link}>＋ Add</Text></TouchableOpacity>} />
      <FlatList
        data={players} keyExtractor={(p) => p.id} contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={[s.sub, { textAlign: 'center', marginTop: 40 }]}>No players yet. Tap “＋ Add”.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => setEditing({ ...item })} onLongPress={() => remove(item)}>
            <Avatar uri={item.photo} fallback={item.name[0]?.toUpperCase()} size={76} />
            <View style={{ flex: 1 }}>
              <Text style={[s.rowText, { fontSize: 20 }]}>{item.name}</Text>
              <Text style={[s.sub, { color: '#ffd66b', marginTop: 2 }]}>⭐ {item.rating || 0}</Text>
            </View>
            <Text style={s.sub}>Edit ›</Text>
          </TouchableOpacity>
        )}
      />
      <Text style={[s.sub, { textAlign: 'center', padding: 8 }]}>Tap to edit · Long-press to delete</Text>
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={s.modalWrap}>
          <View style={s.modal}>
            {editing && (<>
              <Text style={[s.title, { marginBottom: 12 }]}>{editing.id ? 'Edit Player' : 'Add Player'}</Text>
              <TouchableOpacity onPress={async () => { const u = await pickImage(); if (u) setEditing({ ...editing, photo: u }); }} style={{ alignSelf: 'center', alignItems: 'center' }}>
                <Avatar uri={editing.photo} fallback="📷" size={110} />
                <Text style={[s.link, { textAlign: 'center', marginTop: 6 }]}>{editing.photo ? 'Change picture' : 'Upload picture'}</Text>
              </TouchableOpacity>
              <TextInput style={s.input} placeholder="Player name" placeholderTextColor="#777" value={editing.name} onChangeText={(t) => setEditing({ ...editing, name: t })} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn title="Cancel" kind="ghost" sfx="deny" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                <Btn title="Save" onPress={save} style={{ flex: 1 }} />
              </View>
              {editing.id && <Btn title="Delete player" kind="danger" sfx="deny" onPress={() => { const p = editing; setEditing(null); remove(p); }} style={{ marginTop: 10 }} />}
            </>)}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---------- available roles ---------- */
const SwitchRow = ({ title, sub, value, onChange }) => (
  <View style={[s.row, { marginTop: 6 }]}>
    <View style={{ flex: 1 }}>
      <Text style={s.rowText}>{title}</Text>
      {!!sub && <Text style={s.sub}>{sub}</Text>}
    </View>
    <Switch value={!!value} onValueChange={onChange} />
  </View>
);
const StepRow = ({ label, value, onChange, min = 0, max = 9 }) => (
  <>
    <Text style={s.label}>{label}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 }}>
      <TouchableOpacity style={s.stepper} onPress={() => onChange(Math.max(min, value - 1))}><Text style={s.stepText}>−</Text></TouchableOpacity>
      <Text style={s.rowText}>{value}</Text>
      <TouchableOpacity style={s.stepper} onPress={() => onChange(Math.min(max, value + 1))}><Text style={s.stepText}>＋</Text></TouchableOpacity>
    </View>
  </>
);

function Roles({ roles, setRoles, onBack }) {
  const [editing, setEditing] = useState(null);
  const save = () => {
    const name = editing.name.trim();
    if (!name) return Alert.alert('Name required');
    const clean = { ...editing, name, nightPrompt: (editing.nightPrompt || '').trim() };
    if (editing.id) setRoles(roles.map((r) => (r.id === editing.id ? { ...r, ...clean } : r)));
    else setRoles([...roles, { ...clean, id: uid(), builtIn: false }]);
    setEditing(null);
  };
  const remove = (r) => {
    if (r.id === 'villager') return Alert.alert('Villager is required and cannot be deleted.');
    Alert.alert('Delete role', `Remove ${r.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { setRoles(roles.filter((x) => x.id !== r.id)); setEditing(null); } },
    ]);
  };
  const blank = { name: '', team: 'Townie', desc: '', icon: null, hasAction: false, order: 50, targets: 1, nightPrompt: '', canTargetSame: true, ratingGain: 10, winOnVote: false, winOnTarget: false, uses: 0, startNight: 1, actsWhenDead: false, selfAction: false, targetDead: false };
  return (
    <View style={{ flex: 1 }}>
      <Header title="Available Roles" onBack={onBack} right={<TouchableOpacity onPress={() => setEditing(blank)}><Text style={s.link}>＋ Add</Text></TouchableOpacity>} />
      <FlatList
        data={roles} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => setEditing({ ...item })} onLongPress={() => remove(item)}>
            <RoleAvatar role={item} size={76} />
            <View style={{ flex: 1 }}>
              <Text style={[s.rowText, { fontSize: 19 }]}>{item.name}{item.hasAction ? '  🌙' : ''}</Text>
              <Text style={s.sub} numberOfLines={2}>{item.desc}</Text>
              <Text style={[s.sub, { color: '#ffd66b', marginTop: 2 }]}>⭐ +{item.ratingGain ?? 10} on win{item.winOnVote ? ' · wins if voted out' : ''}{item.winOnTarget ? ' · wins if its target is voted out' : ''}</Text>
            </View>
            <Tag team={item.team} />
          </TouchableOpacity>
        )}
      />
      <Text style={[s.sub, { textAlign: 'center', padding: 8 }]}>🌙 = has a night action · Tap to edit</Text>
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={s.modalWrap}>
          <View style={s.modal}>
            {editing && (<>
              <Text style={[s.title, { marginBottom: 10, textAlign: 'center' }]}>{editing.id ? 'Edit Role' : 'Add Role'}</Text>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
                <TouchableOpacity onPress={async () => { const u = await pickImage(); if (u) setEditing({ ...editing, icon: u }); }} style={{ alignSelf: 'center', alignItems: 'center' }}>
                  <RoleAvatar role={editing} size={110} />
                  <Text style={[s.link, { textAlign: 'center', marginTop: 6 }]}>{editing.icon ? 'Change picture' : 'Upload picture / icon'}</Text>
                </TouchableOpacity>
                {editing.icon && <TouchableOpacity onPress={() => setEditing({ ...editing, icon: null })}><Text style={[s.sub, { textAlign: 'center' }]}>Remove my picture (use default)</Text></TouchableOpacity>}
                <Text style={s.label}>Name</Text>
                <TextInput style={s.input} placeholder="Role name" placeholderTextColor="#777" value={editing.name} onChangeText={(t) => setEditing({ ...editing, name: t })} />
                <Text style={s.label}>Category</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                  {['Townie', 'Villain'].map((t) => (
                    <TouchableOpacity key={t} onPress={() => setEditing({ ...editing, team: t })}
                      style={[s.chip, editing.team === t && (t === 'Townie' ? s.chipTown : s.chipVill)]}>
                      <Text style={s.btnText}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.label}>Description</Text>
                <TextInput style={[s.input, { height: 90, textAlignVertical: 'top' }]} multiline placeholder="What does this role do?" placeholderTextColor="#777" value={editing.desc} onChangeText={(t) => setEditing({ ...editing, desc: t })} />

                <Text style={s.label}>Rating gained when this role wins</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 }}>
                  <TouchableOpacity style={s.stepper} onPress={() => setEditing({ ...editing, ratingGain: Math.max(0, (editing.ratingGain ?? 10) - 5) })}><Text style={s.stepText}>−</Text></TouchableOpacity>
                  <Text style={s.rowText}>⭐ +{editing.ratingGain ?? 10}</Text>
                  <TouchableOpacity style={s.stepper} onPress={() => setEditing({ ...editing, ratingGain: Math.min(100, (editing.ratingGain ?? 10) + 5) })}><Text style={s.stepText}>＋</Text></TouchableOpacity>
                </View>
                <SwitchRow title="Wins if voted out" sub="Like the Jester: shares the win with the winning team if voted out in the day"
                  value={editing.winOnVote} onChange={(v) => setEditing({ ...editing, winOnVote: v })} />
                <SwitchRow title="Wins if its target is voted out" sub="Like the Executioner: gets a random target at the start of the game"
                  value={editing.winOnTarget} onChange={(v) => setEditing({ ...editing, winOnTarget: v })} />

                <View style={[s.row, { marginTop: 6 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowText}>Has a night action</Text>
                    <Text style={s.sub}>Moderator wakes this role up each night</Text>
                  </View>
                  <Switch value={!!editing.hasAction} onValueChange={(v) => setEditing({ ...editing, hasAction: v })} />
                </View>
                {editing.hasAction && (<>
                  <Text style={s.label}>Night order (lower wakes up first)</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 }}>
                    <TouchableOpacity style={s.stepper} onPress={() => setEditing({ ...editing, order: Math.max(1, (editing.order ?? 50) - 1) })}><Text style={s.stepText}>−</Text></TouchableOpacity>
                    <Text style={s.rowText}>{editing.order ?? 50}</Text>
                    <TouchableOpacity style={s.stepper} onPress={() => setEditing({ ...editing, order: (editing.order ?? 50) + 1 })}><Text style={s.stepText}>＋</Text></TouchableOpacity>
                  </View>
                  <Text style={s.label}>Players chosen each night</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 }}>
                    <TouchableOpacity style={s.stepper} onPress={() => setEditing({ ...editing, targets: Math.max(1, (editing.targets ?? 1) - 1) })}><Text style={s.stepText}>−</Text></TouchableOpacity>
                    <Text style={s.rowText}>{editing.targets ?? 1}</Text>
                    <TouchableOpacity style={s.stepper} onPress={() => setEditing({ ...editing, targets: Math.min(3, (editing.targets ?? 1) + 1) })}><Text style={s.stepText}>＋</Text></TouchableOpacity>
                  </View>
                  <View style={[s.row, { marginTop: 6 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowText}>Can choose same-role players</Text>
                      <Text style={s.sub}>Turn off so e.g. werewolves can't pick each other</Text>
                    </View>
                    <Switch value={editing.canTargetSame !== false} onValueChange={(v) => setEditing({ ...editing, canTargetSame: v })} />
                  </View>
                  <StepRow label="Uses per game (0 = unlimited)" value={editing.uses ?? 0} min={0} max={9} onChange={(v) => setEditing({ ...editing, uses: v })} />
                  <StepRow label="First night it can act" value={editing.startNight ?? 1} min={1} max={9} onChange={(v) => setEditing({ ...editing, startNight: v })} />
                  <SwitchRow title="No player target" sub="Moderator only asks use it or skip (like the Veteran's alert)"
                    value={editing.selfAction} onChange={(v) => setEditing({ ...editing, selfAction: v })} />
                  <SwitchRow title="Acts after death" sub="Wakes up only once the player is dead (like the Avenger)"
                    value={editing.actsWhenDead} onChange={(v) => setEditing({ ...editing, actsWhenDead: v })} />
                  <SwitchRow title="Picks a dead player" sub="Aimed at dead players (like the Retributionist)"
                    value={editing.targetDead} onChange={(v) => setEditing({ ...editing, targetDead: v })} />
                  <Text style={s.label}>What the moderator asks at night</Text>
                  <TextInput style={[s.input, { height: 70, textAlignVertical: 'top' }]} multiline placeholder="e.g. Doctor, wake up. Who do you want to protect?" placeholderTextColor="#777" value={editing.nightPrompt} onChangeText={(t) => setEditing({ ...editing, nightPrompt: t })} />
                </>)}
              </ScrollView>

              {/* fixed at the bottom */}
              <View style={s.modalFooter}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Btn title="Cancel" kind="ghost" sfx="deny" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                  <Btn title="Save" onPress={save} style={{ flex: 1 }} />
                </View>
                {editing.id && editing.id !== 'villager' && <Btn title="Delete role" kind="danger" sfx="deny" onPress={() => remove(editing)} style={{ marginTop: 10 }} />}
              </View>
            </>)}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---------- card grid helper ---------- */
const useGrid = () => {
  const { width } = useWindowDimensions();
  const cols = width >= 700 ? 4 : 3;
  const gap = 10;
  const cardW = Math.floor((width - 32 - gap * (cols - 1)) / cols);
  return { cols, gap, cardW };
};

/* ---------- new game: pick players (cards) ---------- */
function PickPlayers({ players, selected, setSelected, onBack, onNext, goLibrary, title = 'Select Players', min = 4 }) {
  const { cols, gap, cardW } = useGrid();
  const n = players.filter((p) => selected[p.id]).length;
  const allOn = players.length > 0 && n === players.length;
  return (
    <View style={{ flex: 1 }}>
      <Header title={title} onBack={onBack}
        right={players.length ? <TouchableOpacity onPress={() => { const m = {}; if (!allOn) players.forEach((p) => (m[p.id] = true)); setSelected(m); }}><Text style={s.link}>{allOn ? 'None' : 'All'}</Text></TouchableOpacity> : null} />
      <FlatList
        key={cols} numColumns={cols} columnWrapperStyle={{ gap }}
        data={players} keyExtractor={(p) => p.id} contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <Text style={s.sub}>Your library is empty.</Text>
            <Btn title="Add players" onPress={goLibrary} style={{ marginTop: 12 }} />
          </View>}
        renderItem={({ item }) => {
          const on = !!selected[item.id];
          return (
            <Bounce trigger={on} style={{ width: cardW, marginBottom: gap }}>
              <TouchableOpacity activeOpacity={0.85} style={[s.card, on && s.cardOn]}
                onPress={() => setSelected({ ...selected, [item.id]: !on })}>
                <View>
                  <Avatar uri={item.photo} fallback={item.name[0]?.toUpperCase()} size={Math.min(72, cardW - 40)} />
                  {on && <PopIn from={0.1} style={s.badge}><Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text></PopIn>}
                </View>
                <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
                <Text style={[s.sub, { color: '#ffd66b', fontSize: 12 }]}>⭐ {item.rating || 0}</Text>
              </TouchableOpacity>
            </Bounce>
          );
        }}
      />
      <View style={s.footer}>
        <Text style={[s.sub, { textAlign: 'center', marginBottom: 8 }]}>{n} player{n === 1 ? '' : 's'} selected (min {min})</Text>
        <Btn title="Next" onPress={onNext} disabled={n < min} />
      </View>
    </View>
  );
}

/* ---------- new game: assign roles (cards) ---------- */
function AssignRoles({ roles, counts, setCounts, total, onBack, onReset, onStart }) {
  const { cols, gap, cardW } = useGrid();
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  const sumOk = sum === total;
  const wolves = roles.filter((r) => r.team === 'Villain').reduce((a, r) => a + (counts[r.id] || 0), 0);
  const townies = roles.filter((r) => r.team === 'Townie').reduce((a, r) => a + (counts[r.id] || 0), 0);
  const ok = sumOk && wolves >= 1 && townies >= 1;
  const change = (id, d) => setCounts({ ...counts, [id]: Math.max(0, (counts[id] || 0) + d) });
  return (
    <View style={{ flex: 1 }}>
      <Header title="Confirm Roles" onBack={onBack} right={<TouchableOpacity onPress={onReset}><Text style={s.link}>Auto</Text></TouchableOpacity>} />
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={[s.sub, { textAlign: 'center' }]}>
          Roles set: <Text style={{ color: sumOk ? '#6ee7a8' : '#ff8a8a', fontWeight: '700' }}>{sum} / {total}</Text> players
        </Text>
      </View>
      <FlatList
        key={cols} numColumns={cols} columnWrapperStyle={{ gap }}
        data={roles} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => {
          const c = counts[item.id] || 0;
          return (
            <Bounce trigger={c} style={{ width: cardW, marginBottom: gap }}>
            <View style={[s.card, c > 0 && s.cardOn]}>
              <RoleAvatar role={item} size={Math.min(64, cardW - 30)} />
              <Text style={s.cardName} numberOfLines={1}>{item.name}{item.hasAction ? ' 🌙' : ''}</Text>
              <View style={{ alignSelf: 'center' }}><Tag team={item.team} /></View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <TouchableOpacity style={s.miniStep} onPress={() => change(item.id, -1)}><Text style={s.stepText}>−</Text></TouchableOpacity>
                <Text style={[s.rowText, { minWidth: 20, textAlign: 'center' }]}>{c}</Text>
                <TouchableOpacity style={s.miniStep} onPress={() => change(item.id, 1)}><Text style={s.stepText}>＋</Text></TouchableOpacity>
              </View>
            </View>
            </Bounce>
          );
        }}
      />
      <View style={s.footer}>
        {!sumOk && <Text style={[s.sub, { textAlign: 'center', color: '#ff8a8a', marginBottom: 6 }]}>Total roles must equal {total}.</Text>}
        {sumOk && wolves === 0 && <Text style={[s.sub, { textAlign: 'center', color: '#ff8a8a', marginBottom: 6 }]}>Add at least one Villain role (e.g. Werewolf).</Text>}
        {sumOk && wolves > 0 && townies === 0 && <Text style={[s.sub, { textAlign: 'center', color: '#ff8a8a', marginBottom: 6 }]}>Add at least one Townie role.</Text>}
        <Btn title="Confirm & Hand Out Roles" onPress={onStart} disabled={!ok} />
      </View>
    </View>
  );
}

/* ---------- pass the device: each player checks their own role ---------- */
function RevealRoles({ game, onCancel, onDone }) {
  const [i, setI] = useState(0);
  const [stage, setStage] = useState('pass');   // 'pass' -> 'role' -> (next player) ... -> 'ready'
  const total = game.assignments.length;
  const a = game.assignments[i];
  const last = i === total - 1;
  const villain = a.role.team === 'Villain';
  const targetA = a.target ? game.assignments.find((x) => x.player.id === a.target) : null;   // Executioner's target

  const confirmCancel = () =>
    Alert.alert('Cancel role reveal?', 'Roles will be dealt again next time.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: onCancel },
    ]);

  const next = () => {
    if (last) setStage('ready');
    else { setStage('pass'); setI(i + 1); }
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={stage === 'ready' ? 'Ready to start' : `Player ${i + 1} / ${total}`} onBack={confirmCancel} />
      {/* every stage uses the same scroll layout so the content always starts at the top */}
      <ScrollView contentContainerStyle={s.revealWrap}>

        {/* 1) the next player slides in from the right ("passing the device") */}
        {stage === 'pass' && (
          <FadeUp key={`pass-${i}`} dx={110} dy={0} duration={450} style={{ width: '100%' }}>
            <Text style={[s.sub, { marginBottom: 10 }]}>Pass the device to</Text>
            <Bob><PopIn delay={150} from={0.2}><Avatar uri={a.player.photo} fallback={a.player.name[0]?.toUpperCase()} size={150} /></PopIn></Bob>
            <Text style={[s.title, { fontSize: 34, marginTop: 14 }]}>{a.player.name}</Text>
            <View style={{ height: 26 }} />
            <Text style={[s.sub, { textAlign: 'center', marginVertical: 18 }]}>Make sure nobody else is looking at the screen.</Text>
            <Btn title="Show my role" onPress={() => setStage('role')} style={s.wide} />
          </FadeUp>
        )}

        {/* 2) the role image flips + pops out with a glow and sparkles */}
        {stage === 'role' && (
          <View key={`role-${i}`} style={{ alignItems: 'center', width: '100%' }}>
            <FadeUp dy={8}><Text style={[s.sub, { marginBottom: 10 }]}>{a.player.name}, your role is</Text></FadeUp>
            <View style={{ width: 150, height: 150, alignItems: 'center', justifyContent: 'center' }}>
              <Glow color={villain ? '#ff4d5e' : '#3ddc97'} size={200} />
              <Burst emoji={villain ? '🔥' : '✨'} />
              <FlipIn delay={100}><RoleAvatar role={a.role} size={150} /></FlipIn>
            </View>
            <FadeUp delay={450}><Text style={[s.title, { fontSize: 34, marginTop: 14 }]}>{a.role.name}</Text></FadeUp>
            <FadeUp delay={550}><Tag team={a.role.team} /></FadeUp>
            <FadeUp delay={700}><Text style={[s.rowText, { fontWeight: '400', textAlign: 'center', marginVertical: 18 }]}>{a.role.desc || 'No description.'}</Text></FadeUp>
            {a.role.hasAction && <FadeUp delay={850}><Text style={[s.sub, { textAlign: 'center', marginBottom: 14 }]}>🌙 You will be woken up at night by the moderator.</Text></FadeUp>}
            {!!targetA && <FadeUp delay={850}><Text style={[s.rowText, { textAlign: 'center', color: '#ffd66b', marginBottom: 14 }]}>🎯 Your target: {targetA.player.name}</Text></FadeUp>}
            <FadeUp delay={950} style={{ width: '100%' }}>
              <Btn title={last ? 'Hide my role' : 'Hide role & pass to next player'} onPress={next} style={s.wide} />
            </FadeUp>
          </View>
        )}

        {/* 3) last confirmation before Night 1 */}
        {stage === 'ready' && (
          <View key="ready" style={{ alignItems: 'center', width: '100%' }}>
            <Bob amount={10} duration={1200}><PopIn from={0.2}><Text style={{ fontSize: 64, marginTop: 20 }}>🌙</Text></PopIn></Bob>
            <FadeUp delay={200}><Text style={[s.title, { fontSize: 30, marginTop: 14, textAlign: 'center' }]}>All roles handed out</Text></FadeUp>
            <FadeUp delay={350}>
              <Text style={[s.sub, { textAlign: 'center', marginVertical: 18, lineHeight: 21 }]}>
                Hand the device back to the moderator.{'\n\n'}When everyone has closed their eyes, the moderator starts Night 1.
              </Text>
            </FadeUp>
            <FadeUp delay={500} style={{ width: '100%' }}>
              <Btn title="Start the game (Night 1)" onPress={onDone} style={s.wide} />
            </FadeUp>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/* ---------- IMPOSTOR game (separate from Werewolf) ---------- */
// Flow: pick players -> pick categories -> how many impostors -> pass the device (each player sees the word or "IMPOSTOR") -> discuss -> reveal.
const IMP_CUSTOM_KEY = 'ww_imp_custom_v2';       // [{ id, w, h: [hint1, hint2, hint3] }]
const IMP_CUSTOM_OLD = 'ww_imp_custom_v1';       // old format: plain list of words (no hints)
const CUSTOM_CAT = { id: 'custom', name: 'My words', emoji: '✏️' };
// a custom word is usable only when it has the word and all 3 hints
const isCompleteEntry = (e) => !!e.w && !!e.w.trim() && Array.isArray(e.h) && e.h.length >= 3 && e.h.slice(0, 3).every((x) => !!x && !!x.trim());
// Impostor mode pictures: genuine = knows the word, impostor = the impostor (replace the files in assets/impostor to change them)
const IMP_IMG = { genuine: require('./assets/impostor/genuine.png'), impostor: require('./assets/impostor/impostor.png') };
const ImpImg = ({ kind, size }) => <Image source={IMP_IMG[kind]} style={{ width: size, height: size, borderRadius: size * 0.2 }} />;

// Clockwise / counterclockwise banner (decided randomly at the start of each round)
const Direction = ({ clockwise }) => (
  <View style={{ alignItems: 'center', marginTop: 14 }}>
    <Text style={{ fontSize: 46, color: '#ffd66b' }}>{clockwise ? '↻' : '↺'}</Text>
    <Text style={[s.rowText, { color: '#ffd66b' }]}>{clockwise ? 'Clockwise' : 'Counterclockwise'}</Text>
    <Text style={[s.sub, { textAlign: 'center', marginTop: 2 }]}>
      After each clue, the turn passes to the player on {clockwise ? 'the left' : 'the right'}.
    </Text>
  </View>
);

// Full-screen editor for "My words": each word needs 3 hints
function CustomEditor({ visible, entries, onSave, onClose }) {
  const [list, setList] = useState([]);
  useEffect(() => { if (visible) setList(entries.length ? entries.map((e) => ({ ...e, h: [...e.h] })) : [{ id: uid(), w: '', h: ['', '', ''] }]); }, [visible]);
  const upd = (i, patch) => setList(list.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const updHint = (i, j, t) => upd(i, { h: list[i].h.map((x, k) => (k === j ? t : x)) });
  const doSave = () => onSave(list.filter((e) => e.w.trim() || e.h.some((x) => x.trim())).map((e) => ({ id: e.id, w: e.w.trim(), h: e.h.map((x) => x.trim()) })));
  const save = () => {
    const bad = list.filter((e) => (e.w.trim() || e.h.some((x) => x.trim())) && !isCompleteEntry(e)).length;
    if (bad) Alert.alert('Missing hints', `${bad} word${bad === 1 ? '' : 's'} need a word and 3 hints. Incomplete words are skipped in the game.`, [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Save anyway', onPress: doSave },
    ]);
    else doSave();
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#14162b', paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 }}>
        <Header title="My words" onBack={onClose} right={<TouchableOpacity onPress={save}><Text style={s.link}>Save</Text></TouchableOpacity>} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <Text style={[s.sub, { marginBottom: 10 }]}>Type the secret word and 3 hints about it. Impostors will see the hints (never the word).</Text>
            {list.map((e, i) => (
              <View key={e.id} style={[s.row, { flexDirection: 'column', alignItems: 'stretch', gap: 0 }, !isCompleteEntry(e) && (e.w.trim() || e.h.some((x) => x.trim())) && { borderColor: '#ffcf70' }]}>
                <Text style={s.label}>Word {i + 1}</Text>
                <TextInput style={s.input} placeholder="Secret word (e.g. Dog)" placeholderTextColor="#777" value={e.w} onChangeText={(t) => upd(i, { w: t })} />
                {[0, 1, 2].map((j) => (
                  <TextInput key={j} style={s.input} placeholder={`Hint ${j + 1}`} placeholderTextColor="#777" value={e.h[j]} onChangeText={(t) => updHint(i, j, t)} />
                ))}
                <TouchableOpacity onPress={() => setList(list.filter((_, k) => k !== i))} style={{ alignSelf: 'flex-end', paddingVertical: 4 }}>
                  <Text style={[s.link, { color: '#ff8a8a' }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}
            <Btn title="＋ Add another word" kind="ghost" onPress={() => setList([...list, { id: uid(), w: '', h: ['', '', ''] }])} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function ImpCategories({ custom, picked, setPicked, onSaveCustom, onBack, onNext }) {
  const { cols, gap, cardW } = useGrid();
  const [editing, setEditing] = useState(false);
  const ready = custom.filter(isCompleteEntry).map((e) => ({ w: e.w.trim(), h: e.h.map((x) => x.trim()) }));
  const all = [...IMPOSTOR_CATEGORIES, { ...CUSTOM_CAT, words: ready }];
  const chosen = all.filter((c) => picked[c.id]);
  const total = chosen.reduce((a, c) => a + c.words.length, 0);
  const allOn = chosen.length === all.length;
  return (
    <View style={{ flex: 1 }}>
      <Header title="Choose Categories" onBack={onBack}
        right={<TouchableOpacity onPress={() => { const m = {}; if (!allOn) all.forEach((c) => (m[c.id] = true)); setPicked(m); }}><Text style={s.link}>{allOn ? 'None' : 'All'}</Text></TouchableOpacity>} />
      <Text style={[s.sub, { textAlign: 'center', paddingHorizontal: 16 }]}>Pick one or more. The secret word is chosen randomly from them.</Text>
      <FlatList
        key={cols} numColumns={cols} columnWrapperStyle={{ gap }}
        data={all} keyExtractor={(c) => c.id} contentContainerStyle={{ padding: 16 }}
        ListFooterComponent={
          <TouchableOpacity onPress={() => setEditing(true)} style={{ alignItems: 'center', paddingVertical: 6 }}>
            <Text style={s.link}>✏️ Add / edit my own words ({ready.length}{custom.length > ready.length ? `, ${custom.length - ready.length} incomplete` : ''})</Text>
          </TouchableOpacity>}
        renderItem={({ item }) => {
          const on = !!picked[item.id];
          return (
            <Bounce trigger={on} style={{ width: cardW, marginBottom: gap }}>
              <TouchableOpacity activeOpacity={0.85} style={[s.card, on && s.cardOn]} onPress={() => setPicked({ ...picked, [item.id]: !on })}>
                <View>
                  <Text style={{ fontSize: Math.min(44, cardW - 50) }}>{item.emoji}</Text>
                  {on && <PopIn from={0.1} style={s.badge}><Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text></PopIn>}
                </View>
                <Text style={s.cardName} numberOfLines={2}>{item.name}</Text>
                <Text style={[s.sub, { fontSize: 12 }]}>{item.words.length} words</Text>
              </TouchableOpacity>
            </Bounce>
          );
        }}
      />
      <View style={s.footer}>
        <Text style={[s.sub, { textAlign: 'center', marginBottom: 8 }]}>{chosen.length} categor{chosen.length === 1 ? 'y' : 'ies'} · {total} words</Text>
        <Btn title="Next" onPress={onNext} disabled={total === 0} />
      </View>
      <CustomEditor visible={editing} entries={custom} onSave={(l) => { onSaveCustom(l); setEditing(false); }} onClose={() => setEditing(false)} />
    </View>
  );
}

function ImpSetup({ n, count, setCount, hints, setHints, seeMates, setSeeMates, onBack, onStart }) {
  const all = count === n;
  return (
    <View style={{ flex: 1 }}>
      <Header title="Impostors" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={{ alignItems: 'center', marginVertical: 12 }}>
          <Bob><ImpImg kind="impostor" size={120} /></Bob>
          <Text style={[s.sub, { marginTop: 10 }]}>How many impostors?</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22, marginTop: 8 }}>
            <TouchableOpacity style={[s.stepper, { width: 52, height: 52, borderRadius: 26 }]} onPress={() => setCount(Math.max(1, count - 1))}><Text style={s.stepText}>−</Text></TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: 54, fontWeight: '800', minWidth: 70, textAlign: 'center' }}>{count}</Text>
            <TouchableOpacity style={[s.stepper, { width: 52, height: 52, borderRadius: 26 }]} onPress={() => setCount(Math.min(n, count + 1))}><Text style={s.stepText}>＋</Text></TouchableOpacity>
          </View>
          <Text style={[s.rowText, { marginTop: 10, fontWeight: '400' }]}>{count} impostor{count === 1 ? '' : 's'} · {n - count} with the word</Text>
          <TouchableOpacity onPress={() => setCount(n)} style={{ marginTop: 8 }}><Text style={s.link}>Make everyone an impostor</Text></TouchableOpacity>
          {all && <Text style={[s.sub, { color: '#ffcf70', textAlign: 'center', marginTop: 8 }]}>Everyone is an impostor — nobody will know the word!</Text>}
        </View>
        <StepRow label="Hints shown to each impostor (0 = none, 3 recommended)" value={hints} min={0} max={5} onChange={setHints} />
        <Text style={[s.sub, { marginBottom: 10 }]}>Hints are picked at random from the word's hint list, so they differ every round.</Text>
        <SwitchRow title="Impostors know each other" sub="Each impostor is shown the other impostors" value={seeMates} onChange={setSeeMates} />
      </ScrollView>
      <View style={s.footer}><Btn title="Confirm & Hand Out Cards" onPress={onStart} /></View>
    </View>
  );
}

function ImpReveal({ deal, onCancel, onDone }) {
  const [i, setI] = useState(0);
  const [stage, setStage] = useState('pass');   // 'pass' -> 'card' -> (next player) ... -> 'ready'
  const total = deal.cards.length;
  const c = deal.cards[i];
  const last = i === total - 1;
  const mates = deal.seeMates ? deal.cards.filter((x) => x.impostor && x.player.id !== c.player.id) : [];
  const confirmCancel = () =>
    Alert.alert('Cancel?', 'A new word will be picked next time.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: onCancel },
    ]);
  const next = () => { if (last) setStage('ready'); else { setStage('pass'); setI(i + 1); } };
  return (
    <View style={{ flex: 1 }}>
      <Header title={stage === 'ready' ? 'Ready to play' : `Player ${i + 1} / ${total}`} onBack={confirmCancel} />
      <ScrollView contentContainerStyle={s.revealWrap}>
        {stage === 'pass' && (
          <FadeUp key={`pass-${i}`} dx={110} dy={0} duration={450} style={{ width: '100%' }}>
            <Text style={[s.sub, { marginBottom: 10 }]}>Pass the device to</Text>
            <Bob><PopIn delay={150} from={0.2}><Avatar uri={c.player.photo} fallback={c.player.name[0]?.toUpperCase()} size={150} /></PopIn></Bob>
            <Text style={[s.title, { fontSize: 34, marginTop: 14 }]}>{c.player.name}</Text>
            <View style={{ height: 26 }} />
            <Text style={[s.sub, { textAlign: 'center', marginVertical: 18 }]}>Make sure nobody else is looking at the screen.</Text>
            <Btn title="Show my card" onPress={() => setStage('card')} style={s.wide} />
          </FadeUp>
        )}
        {stage === 'card' && (
          <View key={`card-${i}`} style={{ alignItems: 'center', width: '100%' }}>
            <FadeUp dy={8}><Text style={[s.sub, { marginBottom: 10 }]}>{c.player.name}, you are…</Text></FadeUp>
            <View style={{ width: 170, height: 150, alignItems: 'center', justifyContent: 'center' }}>
              <Glow color={c.impostor ? '#ff4d5e' : '#3ddc97'} size={210} />
              <Burst emoji={c.impostor ? '🔥' : '✨'} />
              <FlipIn delay={100}><ImpImg kind={c.impostor ? 'impostor' : 'genuine'} size={150} /></FlipIn>
            </View>
            {c.impostor ? (
              <>
                <FadeUp delay={450}><Text style={[s.title, { fontSize: 38, marginTop: 14, color: '#ff6b7a' }]}>IMPOSTOR</Text></FadeUp>
                <FadeUp delay={600}><Text style={[s.rowText, { fontWeight: '400', textAlign: 'center', marginTop: 16 }]}>You don't know the word. Blend in!</Text></FadeUp>
                {c.hints.length > 0 && (
                  <FadeUp delay={700} style={{ width: '100%', marginTop: 14 }}>
                    <Text style={[s.sub, { textAlign: 'center', marginBottom: 6 }]}>Your hints about the word</Text>
                    {c.hints.map((h, k) => (
                      <View key={k} style={[s.row, { justifyContent: 'center', backgroundColor: '#2b2250', marginBottom: 8 }]}>
                        <Text style={[s.rowText, { color: '#ffd66b', textAlign: 'center' }]}>{h}</Text>
                      </View>
                    ))}
                  </FadeUp>
                )}
                {mates.length > 0 && <FadeUp delay={800}><Text style={[s.rowText, { textAlign: 'center', marginTop: 12 }]}>Other impostors: {mates.map((m) => m.player.name).join(', ')}</Text></FadeUp>}
              </>
            ) : (
              <>
                <FadeUp delay={450}><Text style={[s.sub, { marginTop: 14, textAlign: 'center' }]}>The secret word is</Text></FadeUp>
                <FadeUp delay={550}><Text style={[s.title, { fontSize: 40, marginTop: 6, textAlign: 'center', color: '#6ee7a8' }]}>{deal.word}</Text></FadeUp>
              </>
            )}
            <FadeUp delay={950} style={{ width: '100%', marginTop: 26 }}>
              <Btn title={last ? 'Hide my card' : 'Hide card & pass to next player'} onPress={next} style={s.wide} />
            </FadeUp>
          </View>
        )}
        {stage === 'ready' && (
          <View key="ready" style={{ alignItems: 'center', width: '100%' }}>
            <Bob amount={10} duration={1200}><PopIn from={0.2}><View style={{ marginTop: 20 }}><ImpImg kind="genuine" size={120} /></View></PopIn></Bob>
            <FadeUp delay={200}><Text style={[s.title, { fontSize: 30, marginTop: 14, textAlign: 'center' }]}>Everyone has their card</Text></FadeUp>
            <FadeUp delay={350}>
              <Text style={[s.sub, { textAlign: 'center', marginTop: 18, lineHeight: 21 }]}>Put the device in the middle of the table.</Text>
              <Direction clockwise={deal.clockwise} />
              <View style={{ height: 18 }} />
            </FadeUp>
            <FadeUp delay={500} style={{ width: '100%' }}><Btn title="Start the round" onPress={onDone} style={s.wide} /></FadeUp>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function ImpPlay({ deal, onAgain, onSettings, onExit }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { setShown(false); }, [deal]);
  return (
    <View style={{ flex: 1 }}>
      <Header title={shown ? 'Result' : 'Discussion'} onBack={() => Alert.alert('End round?', 'Return to the main menu?', [{ text: 'Cancel', style: 'cancel' }, { text: 'End', style: 'destructive', onPress: onExit }])} />
      <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
        {!shown ? (
          <>
            <Bob><View style={{ marginTop: 10 }}><ImpImg kind="genuine" size={120} /></View></Bob>
            <Text style={[s.title, { fontSize: 26, textAlign: 'center', marginTop: 10 }]}>{deal.first.name} starts!</Text>
            <Direction clockwise={deal.clockwise} />
            <Text style={[s.sub, { textAlign: 'center', marginTop: 14, lineHeight: 21 }]}>
              Take turns saying one clue about the word without saying it.{'\n'}Impostors try to blend in.{'\n'}When everyone is ready, vote for who you think the impostor is.
            </Text>
          </>
        ) : (
          <>
            <Text style={s.sub}>The secret word was</Text>
            <Text style={[s.title, { fontSize: 40, color: '#6ee7a8', marginVertical: 6, textAlign: 'center' }]}>{deal.word}</Text>
            <Text style={[s.sub, { marginBottom: 14 }]}>Category: {deal.category}</Text>
            {deal.cards.map((c, idx) => (
              <FadeUp key={c.player.id} delay={idx * 80} dy={14} style={{ width: '100%' }}>
                <View style={[s.row, { width: '100%' }, c.impostor && { borderColor: '#ff6b7a', backgroundColor: '#3a1820' }]}>
                  <Avatar uri={c.player.photo} fallback={c.player.name[0]?.toUpperCase()} />
                  <Text style={[s.rowText, { flex: 1 }]}>{c.player.name}</Text>
                  <ImpImg kind={c.impostor ? 'impostor' : 'genuine'} size={36} />
                  <Text style={[s.rowText, { color: c.impostor ? '#ff6b7a' : '#6ee7a8' }]}>{c.impostor ? 'Impostor' : 'Knew the word'}</Text>
                </View>
              </FadeUp>
            ))}
          </>
        )}
      </ScrollView>
      <View style={s.footer}>
        {!shown ? (
          <Btn title="Reveal the impostors" onPress={() => setShown(true)} />
        ) : (
          <>
            <Btn title="Play again (new word)" onPress={onAgain} style={{ marginBottom: 10 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title="Change settings" kind="ghost" sfx="deny" onPress={onSettings} style={{ flex: 1 }} />
              <Btn title="Main menu" kind="ghost" sfx="deny" onPress={onExit} style={{ flex: 1 }} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/* ---------- game (moderator) ---------- */
function Game({ game, setGame, roles, onExit, onRematch, onAward }) {
  useKeepAwake();
  const villagerRole = (roles || []).find((r) => r.id === 'villager') || DEFAULT_ROLES[0];
  const [phase, setPhase] = useState('night');
  const [day, setDay] = useState(1);
  const [steps, setSteps] = useState(() => buildNightSteps(game.assignments, 1));
  const [stepIdx, setStepIdx] = useState(0);
  const [actions, setActions] = useState({});      // roleId -> [playerId] | ['none'] | ['self']
  const [showHolders, setShowHolders] = useState(false);
  const [lastNight, setLastNight] = useState('');
  const [voteMsg, setVoteMsg] = useState('');
  const [sel, setSel] = useState(null);            // player selected in the day, waiting for the moderator to confirm the vote
  const [discussMins, setDiscussMins] = useState(5);
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const [reveal, setReveal] = useState(false);     // roles hidden by default
  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const [silenced, setSilenced] = useState(null);   // player silenced by the police for the day
  const { cols, gap, cardW } = useGrid();
  const night = phase === 'night';

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) { setRunning(false); return 0; }
        return l - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  // big "Night 2" / "Day 3" banner whenever the phase changes
  const banner = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    banner.setValue(0);
    Animated.sequence([
      Animated.timing(banner, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(banner, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();
  }, [phase, day]);
  // leaving the game goes back to the main theme
  useEffect(() => () => Sound.setTrack('main'), []);

  const find = (pid) => game.assignments.find((a) => a.player.id === pid);
  const aliveList = game.assignments.filter((a) => a.alive);
  const inSteps = night && stepIdx < steps.length;

  // Everything that happens tonight (computed once per set of choices so random results stay stable)
  const res = useMemo(
    () => (night && stepIdx >= steps.length ? resolveNight(game.assignments, steps, actions, villagerRole) : null),
    [night, stepIdx, steps, actions, game.assignments, villagerRole],
  );

  const toDay = () => {
    const r = res;
    setGame({ assignments: r.assignments });
    const nm = (ids) => ids.map((id) => find(id).player.name).join(', ');
    let msg = r.deaths.length ? `${nm(r.deaths)} ${r.deaths.length > 1 ? 'were' : 'was'} eliminated during the night.` : 'Nobody died last night.';
    if (r.revived.length) msg += ` ${nm(r.revived)} returned from the dead!`;
    if (r.deaths.length) Sound.play('killed');   // killed.wav only for night kills, never for day votes
    setLastNight(msg);
    setVoteMsg('');
    setSel(null);
    const pol = actions.police;
    const pid = pol && pol[0] && pol[0] !== 'none' ? pol[0] : null;
    setSilenced(pid && r.assignments.some((a) => a.player.id === pid && a.alive) ? pid : null);
    setPhase('day');
    setLeft(discussMins * 60);
    setRunning(true);
  };

  const toNight = () => {
    setPhase('night');
    setRunning(false);
    setDay(day + 1);
    setSilenced(null);
    setSel(null);
    setVoteMsg('');
    setSteps(buildNightSteps(game.assignments, day + 1));
    setStepIdx(0);
    setActions({});
    setShowHolders(false);
  };

  // Day: tap a player to SELECT them, then confirm with the button at the bottom (no killed sound for votes)
  const selA = sel ? find(sel) : null;
  const voteOut = () => {
    if (!selA) return;
    const pid = selA.player.id;
    let msg = `${selA.player.name} was voted out.`;
    if (selA.role.winOnVote) msg += ` 🃏 ${selA.role.name} — the game continues!`;
    game.assignments.forEach((a) => { if (a.role.winOnTarget && a.alive && a.target === pid) msg += ` ⚔️ ${a.player.name} (${a.role.name}) got their target!`; });
    setGame({
      assignments: game.assignments.map((a) => {
        if (a.player.id === pid) return { ...a, alive: false, votedOut: true };
        if (a.role.winOnTarget && a.alive && a.target === pid) return { ...a, won: true };
        return a;
      }),
    });
    setVoteMsg(msg);
    setSel(null);
  };
  const bringBack = () => {
    if (!selA) return;
    const pid = selA.player.id;
    setGame({
      assignments: game.assignments.map((a) => {
        if (a.player.id === pid) return { ...a, alive: true, votedOut: false, doomed: false };
        if (a.role.winOnTarget && a.target === pid) return { ...a, won: false };
        return a;
      }),
    });
    setVoteMsg(`${selA.player.name} is back in the game.`);
    setSel(null);
  };

  // Win check: Townies / Villains decide the game. Jester (voted out) and Executioner (target voted out) share the win.
  const villains = aliveList.filter((a) => a.role.team === 'Villain').length;
  const towns = aliveList.length - villains;
  const baseKind = aliveList.length === 0 ? 'none' : villains === 0 ? 'townie' : villains >= towns ? 'villain' : null;
  const co = game.assignments.filter((a) => (a.role.winOnVote && a.votedOut && !a.alive) || (a.role.winOnTarget && a.won));
  const coNames = [...new Set(co.map((a) => a.role.name))];
  const winText = !baseKind ? null
    : baseKind === 'none' ? 'Nobody wins 🤝'
    : `${baseKind === 'townie' ? 'Townies win' : 'Villains win'}${coNames.length ? ` with ${coNames.join(' & ')}` : ''}! ${baseKind === 'townie' ? '🎉' : '🐺'}`;
  const winKey = baseKind ? `${baseKind}:${co.map((a) => a.player.id).sort().join(',')}` : null;
  const winner = winText;
  useEffect(() => { if (!winKey) setDismissed(null); }, [winKey]);
  const gameOver = !!winKey && dismissed !== winKey;
  // night music / day music
  useEffect(() => { if (!gameOver) Sound.setTrack(night ? 'night' : 'day'); }, [night, gameOver]);

  const step = inSteps ? steps[stepIdx] : null;
  const rid = step ? step.role.id : null;
  const selfOnly = !!(step && step.role.selfAction);
  // roles with canTargetSame === false (e.g. werewolf, hunter) cannot pick players holding the same role;
  // "picks a dead player" roles (Retributionist) choose among the dead
  const targetList = step
    ? (step.role.targetDead ? game.assignments.filter((a) => !a.alive) : aliveList.filter((a) => step.role.canTargetSame !== false || a.role.id !== rid))
    : [];
  const need = step ? Math.max(1, Math.min(step.role.targets || 1, targetList.length)) : 1;
  const picks = step ? (actions[rid] || []) : [];
  const ready = picks.includes('none') || picks.includes('self') || picks.length === need;
  const toggle = (pid) => {
    let next;
    if (need === 1) next = [pid];
    else {
      const cur = picks.filter((x) => x !== 'none');
      next = cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid].slice(-need);
    }
    setActions({ ...actions, [rid]: next });
  };
  const firstPick = picks.find((x) => x !== 'none' && x !== 'self');
  const seerTarget = step && rid === 'seer' && firstPick ? find(firstPick) : null;
  const hexTarget = step && rid === 'hexer' && firstPick ? find(firstPick) : null;
  const usesLeft = step && step.role.uses > 0 ? Math.max(0, ...step.holders.map((h) => step.role.uses - ((find(h.id) || {}).used || 0))) : null;
  const goStep = (d) => { setStepIdx(stepIdx + d); setShowHolders(false); };

  const bg = night ? '#0d1030' : '#3a2f12';

  if (gameOver) {
    return <GameOver winner={winner} winKind={baseKind} assignments={game.assignments} onKeep={() => setDismissed(winKey)} onAward={onAward} onRematch={onRematch} onExit={onExit} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <Header title={night ? `🌙 Night ${day}` : `☀️ Day ${day}`}
        onBack={() => Alert.alert('End game?', 'Return to the main menu?', [{ text: 'Cancel', style: 'cancel' }, { text: 'End', style: 'destructive', onPress: onExit }])} />

      {winner && <Text style={{ color: '#ffd66b', textAlign: 'center', fontSize: 20, fontWeight: '800', marginBottom: 6 }}>{winner}</Text>}

      {/* ---------- NIGHT: one role at a time ---------- */}
      {inSteps && (
        <>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <Text style={s.sub}>Step {stepIdx + 1} of {steps.length}</Text>
              <PopIn key={rid} from={0.2}><RoleAvatar role={step.role} size={84} /></PopIn>
              <Text style={[s.title, { marginTop: 6 }]}>{step.role.name}</Text>
              <Text style={[s.rowText, { fontWeight: '400', textAlign: 'center', marginTop: 8 }]}>
                “{step.role.nightPrompt || `${step.role.name}, wake up. Who do you choose?`}”
              </Text>
              {usesLeft != null && <Text style={[s.sub, { marginTop: 6 }]}>Uses left: {usesLeft}</Text>}
              <TouchableOpacity onPress={() => setShowHolders(!showHolders)} style={{ marginTop: 8 }}>
                <Text style={s.link}>{showHolders ? `Playing: ${step.holders.map((p) => p.name).join(', ')}` : 'Show who has this role'}</Text>
              </TouchableOpacity>
            </View>

            {selfOnly ? (
              <>
                <TouchableOpacity style={[s.row, picks.includes('self') && s.rowOn]} onPress={() => setActions({ ...actions, [rid]: ['self'] })}>
                  <Text style={[s.rowText, { flex: 1 }]}>🛡️ Go on alert tonight</Text>
                  {picks.includes('self') && <Text style={{ fontSize: 22 }}>🎯</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[s.row, picks.includes('none') && s.rowOn]} onPress={() => setActions({ ...actions, [rid]: ['none'] })}>
                  <Text style={[s.rowText, { flex: 1 }]}>🏠 Stay home (keep the power)</Text>
                  {picks.includes('none') && <Text style={{ fontSize: 22 }}>🎯</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[s.label, { marginLeft: 4 }]}>
                  {step.role.targetDead ? 'Choose a dead player' : need > 1 ? `Choose ${need} players (${picks.filter((x) => x !== 'none').length}/${need})` : 'Chosen player'}
                </Text>
                {step.role.canTargetSame === false && !step.role.targetDead && <Text style={[s.sub, { marginLeft: 4, marginBottom: 6 }]}>Players with the same role can't be chosen.</Text>}
                {targetList.length === 0 && <Text style={[s.sub, { marginLeft: 4, marginBottom: 6 }]}>Nobody can be chosen.</Text>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, marginBottom: gap }}>
                  {targetList.map((a, idx) => {
                    const on = picks.includes(a.player.id);
                    return (
                      <PopIn key={rid + a.player.id} delay={idx * 45} from={0.6} style={{ width: cardW }}>
                        <TouchableOpacity activeOpacity={0.85} style={[s.card, { width: '100%' }, on && s.cardOn]} onPress={() => toggle(a.player.id)}>
                          <View>
                            <Avatar uri={a.player.photo} fallback={a.player.name[0]?.toUpperCase()} size={Math.min(72, cardW - 40)} />
                            {on && <PopIn from={0.1} style={s.badge}><Text style={{ fontSize: 13 }}>🎯</Text></PopIn>}
                          </View>
                          <Text style={s.cardName} numberOfLines={1}>{a.player.name}</Text>
                        </TouchableOpacity>
                      </PopIn>
                    );
                  })}
                </View>
                <TouchableOpacity style={[s.row, picks.includes('none') && s.rowOn]} onPress={() => setActions({ ...actions, [rid]: ['none'] })}>
                  <Text style={[s.rowText, { flex: 1 }]}>No one / skip</Text>
                  {picks.includes('none') && <Text style={{ fontSize: 22 }}>🎯</Text>}
                </TouchableOpacity>
              </>
            )}

            {seerTarget && (
              <View style={[s.row, { justifyContent: 'center', backgroundColor: seerTarget.role.team === 'Villain' ? '#5a1b25' : '#1b4d38' }]}>
                <Text style={s.rowText}>
                  🔮 {seerTarget.player.name} is a {seerTarget.role.team === 'Villain' ? 'VILLAIN 🐺' : 'TOWNIE 🏘️'}
                </Text>
              </View>
            )}
            {hexTarget && (
              <View style={[s.row, { justifyContent: 'center', backgroundColor: hexTarget.role.id === 'vampire' ? '#3a1a4a' : '#262a4d' }]}>
                <Text style={s.rowText}>
                  🧪 {hexTarget.player.name} {hexTarget.role.id === 'vampire' ? 'is a Vampire — they become a Villager!' : 'is not a Vampire — nothing happens.'}
                </Text>
              </View>
            )}
          </ScrollView>
          <View style={[s.footer, { flexDirection: 'row', gap: 10 }]}>
            {stepIdx > 0 && <Btn title="‹ Back" kind="ghost" sfx="deny" onPress={() => goStep(-1)} style={{ flex: 1 }} />}
            <Btn title={stepIdx === steps.length - 1 ? 'Finish night' : 'Next role ›'} onPress={() => goStep(1)} disabled={!ready} style={{ flex: 2 }} />
          </View>
        </>
      )}

      {/* ---------- NIGHT: summary ---------- */}
      {night && !inSteps && res && (
        <>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 48 }}>🌙</Text>
              <Text style={s.title}>Night summary</Text>
              <Text style={s.sub}>Only you (the moderator) should see this.</Text>
            </View>
            {steps.length === 0 && <Text style={[s.sub, { textAlign: 'center' }]}>No roles with a night action are available tonight.</Text>}
            {steps.map((st) => {
              const acts = actions[st.role.id] || [];
              const ids = acts.filter((x) => x !== 'none' && x !== 'self');
              const t = ids.length ? find(ids[0]) : null;
              const names = ids.map((id) => find(id).player.name).join(st.role.id === 'transporter' ? ' ↔ ' : ', ');
              const line = st.role.selfAction ? (acts.includes('self') ? '→ On alert' : '→ Stayed home')
                : t ? `→ ${names}${st.role.id === 'seer' ? ` (${t.role.team})` : ''}${st.role.id === 'police' ? ' (silenced tomorrow)' : ''}` : '→ No one';
              return (
                <View key={st.role.id} style={s.row}>
                  <RoleAvatar role={st.role} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowText}>{st.role.name}</Text>
                    <Text style={s.sub}>{line}</Text>
                  </View>
                </View>
              );
            })}
            {res.events.length === 0 && (
              <View style={[s.row, { backgroundColor: '#2b2250' }]}><Text style={[s.rowText, { flex: 1 }]}>Nobody will die tonight.</Text></View>
            )}
            {res.events.map((e, i) => (
              <View key={i} style={[s.row, { backgroundColor: e.kind === 'death' ? '#4a1d28' : '#2b2250' }]}>
                <Text style={[s.rowText, { flex: 1 }]}>{e.text}</Text>
              </View>
            ))}
            {res.events.length > 0 && res.deaths.length === 0 && (
              <View style={[s.row, { backgroundColor: '#2b2250' }]}><Text style={[s.rowText, { flex: 1 }]}>Nobody will die tonight.</Text></View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}>
              <Text style={s.sub}>Discussion timer:</Text>
              <TouchableOpacity style={s.stepper} onPress={() => setDiscussMins(Math.max(1, discussMins - 1))}><Text style={s.stepText}>−</Text></TouchableOpacity>
              <Text style={s.rowText}>{discussMins} min</Text>
              <TouchableOpacity style={s.stepper} onPress={() => setDiscussMins(discussMins + 1)}><Text style={s.stepText}>＋</Text></TouchableOpacity>
            </View>
          </ScrollView>
          <View style={[s.footer, { flexDirection: 'row', gap: 10 }]}>
            {steps.length > 0 && <Btn title="‹ Back" kind="ghost" sfx="deny" onPress={() => goStep(-1)} style={{ flex: 1 }} />}
            <Btn title="☀️ Turn to Day" onPress={toDay} style={{ flex: 2 }} />
          </View>
        </>
      )}

      {/* ---------- DAY ---------- */}
      {!night && (
        <>
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            {!!lastNight && <Text style={[s.rowText, { marginBottom: 6, textAlign: 'center', paddingHorizontal: 16 }]}>{lastNight}</Text>}
            {!!voteMsg && <Text style={[s.rowText, { marginBottom: 6, color: '#ffd66b', textAlign: 'center', paddingHorizontal: 16 }]}>{voteMsg}</Text>}
            {!!silenced && !!find(silenced) && <Text style={[s.rowText, { marginBottom: 6, color: '#ffcf70', textAlign: 'center', paddingHorizontal: 16 }]}>🤐 {find(silenced).player.name} is silenced and can't talk today.</Text>}
            <Text style={{ fontSize: 56, color: '#fff', fontWeight: '800', fontVariant: ['tabular-nums'] }}>{mmss(left)}</Text>
            <Text style={s.sub}>{left === 0 ? "Time's up — vote!" : running ? 'Discussion time' : 'Paused'}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Btn title={running ? 'Pause' : 'Resume'} kind="ghost" sfx="none" disabled={left === 0} onPress={() => setRunning(!running)} style={s.small} />
              <Btn title="+1 min" kind="ghost" sfx="none" onPress={() => setLeft(left + 60)} style={s.small} />
              <Btn title="Reset" kind="ghost" sfx="none" onPress={() => { setLeft(discussMins * 60); setRunning(false); }} style={s.small} />
            </View>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 }}>
            <Text style={s.sub}>Alive {aliveList.length}</Text>
            <TouchableOpacity onPress={() => setReveal(!reveal)}><Text style={s.link}>{reveal ? 'Hide roles' : 'Show roles'}</Text></TouchableOpacity>
          </View>

          <FlatList
            key={cols} numColumns={cols} columnWrapperStyle={{ gap }}
            data={game.assignments} keyExtractor={(a) => a.player.id} contentContainerStyle={{ padding: 16 }}
            extraData={[reveal, silenced, sel]}
            renderItem={({ item }) => (
              <TouchableOpacity activeOpacity={0.85}
                style={[s.card, { width: cardW, marginBottom: gap }, !item.alive && { opacity: 0.4 }, sel === item.player.id && s.cardOn]}
                onPress={() => setSel(sel === item.player.id ? null : item.player.id)} onLongPress={() => setInfo(item.role)}>
                <View>
                  <Avatar uri={item.player.photo} fallback={item.player.name[0]?.toUpperCase()} size={Math.min(72, cardW - 40)} />
                  <Text style={s.stateBadge}>{item.alive ? '❤️' : '💀'}</Text>
                  {silenced === item.player.id && <Text style={[s.stateBadge, { bottom: undefined, top: -6, right: undefined, left: -10 }]}>🤐</Text>}
                  {sel === item.player.id && <PopIn from={0.1} style={s.badge}><Text style={{ fontSize: 13 }}>🎯</Text></PopIn>}
                </View>
                <Text style={[s.cardName, !item.alive && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{item.player.name}</Text>
                {reveal && <Text style={s.sub} numberOfLines={1}>{item.role.name}</Text>}
                {reveal && <View style={{ alignSelf: 'center' }}><Tag team={item.role.team} /></View>}
              </TouchableOpacity>
            )}
          />
          <Text style={[s.sub, { textAlign: 'center' }]}>Tap a player to select · Long-press = role info (moderator)</Text>
          <View style={[s.footer, { flexDirection: 'row', gap: 10 }]}>
            {selA ? (
              <>
                <Btn title="Cancel" kind="ghost" sfx="deny" onPress={() => setSel(null)} style={{ flex: 1 }} />
                {selA.alive
                  ? <Btn title={`⚖️ Vote out ${selA.player.name}`} kind="danger" sfx="none" onPress={voteOut} style={{ flex: 2 }} />
                  : <Btn title={`↩️ Bring back ${selA.player.name}`} sfx="none" onPress={bringBack} style={{ flex: 2 }} />}
              </>
            ) : <Btn title="🌙 Turn to Night" onPress={toNight} style={{ flex: 1 }} />}
          </View>
        </>
      )}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: night ? 'rgba(5,6,25,0.88)' : 'rgba(58,40,6,0.88)', opacity: banner,
      }]}>
        <Animated.Text style={{ fontSize: 46, fontWeight: '800', color: '#fff', transform: [{ scale: banner.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }}>
          {night ? `🌙  Night ${day}` : `☀️  Day ${day}`}
        </Animated.Text>
      </Animated.View>

      <Modal visible={!!info} transparent animationType="fade" onRequestClose={() => setInfo(null)}>
        <View style={s.modalWrap}>
          <View style={s.modal}>
            {info && (<>
              <View style={{ alignItems: 'center' }}>
                <RoleAvatar role={info} size={90} />
                <Text style={[s.title, { marginTop: 8 }]}>{info.name}</Text>
                <View style={{ alignSelf: 'center' }}><Tag team={info.team} /></View>
              </View>
              <Text style={[s.rowText, { marginVertical: 14, fontWeight: '400' }]}>{info.desc || 'No description.'}</Text>
              <Btn title="Close" sfx="deny" onPress={() => setInfo(null)} />
            </>)}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---------- game over ---------- */
// Who gains rating: a team win rewards every player on that team (alive or dead). Co-winners — a Jester who was voted out,
// an Executioner whose target was voted out — also win and gain their role's ratingGain. They are not rewarded just for
// being on the winning team. Each player gains the ratingGain of their role.
const computeResult = (assignments, kind) => {
  const gains = {};
  if (kind === 'none' || !kind) return gains;
  assignments.forEach((a) => {
    let won = false;
    if (a.role.winOnVote) won = !!a.votedOut && !a.alive;
    else if (a.role.winOnTarget) won = !!a.won;
    else won = a.role.team === (kind === 'townie' ? 'Townie' : 'Villain');
    if (won) gains[a.player.id] = a.role.ratingGain ?? 10;
  });
  return gains;
};

function GameOver({ winner, winKind, assignments, onKeep, onAward, onRematch, onExit }) {
  const gains = computeResult(assignments, winKind);
  const anyGain = Object.keys(gains).length > 0;
  const bgColor = { townie: '#12351f', villain: '#3a1018', none: '#25262e' }[winKind];
  const icon = { townie: '🎉', villain: '🐺', none: '🤝' }[winKind];
  const burst = { townie: '🎉', villain: '🔥', none: '✨' }[winKind];
  // theme pauses, the win jingle plays (after the "killed" sound if someone just died), theme resumes on close
  useEffect(() => {
    Sound.pauseMusic();
    const which = winKind === 'villain' ? 'villain' : winKind === 'none' ? 'deny' : 'victory';
    const sinceKill = Date.now() - Sound.lastKilled;
    const wait = sinceKill < 6000 ? Math.max(700, 5300 - sinceKill) : 700;
    const t = setTimeout(() => Sound.play(which), wait);
    return () => { clearTimeout(t); Sound.stop('victory'); Sound.stop('villain'); Sound.playMusic(); };
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: bgColor }}>
      <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
        <View style={{ marginTop: 10, height: 84, alignItems: 'center', justifyContent: 'center' }}>
          <Burst emoji={burst} count={10} radius={120} />
          <PopIn from={0.1}><Text style={{ fontSize: 64 }}>{icon}</Text></PopIn>
        </View>
        <FadeUp delay={300}><Text style={[s.title, { fontSize: 30, marginVertical: 6, textAlign: 'center' }]}>{winner}</Text></FadeUp>
        <Text style={[s.sub, { marginBottom: 16 }]}>Game over — here is who everyone was</Text>
        {assignments.map((a, idx) => (
          <FadeUp key={a.player.id} delay={500 + idx * 70} dy={16} style={{ width: '100%' }}>
            <View style={[s.row, { width: '100%' }, !a.alive && { opacity: 0.65 }, gains[a.player.id] != null && { borderColor: '#ffd66b' }]}>
              <Avatar uri={a.player.photo} fallback={a.player.name[0]?.toUpperCase()} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowText}>{a.player.name}</Text>
                <Text style={s.sub}>{a.role.name}</Text>
                {gains[a.player.id] != null && (
                  <Text style={{ color: '#ffd66b', fontSize: 13, fontWeight: '700' }}>
                    🏆 +{gains[a.player.id]} ⭐  (total {(a.player.rating || 0) + gains[a.player.id]})
                  </Text>
                )}
              </View>
              <RoleAvatar role={a.role} size={36} />
              <Tag team={a.role.team} />
              <Text style={{ fontSize: 20 }}>{a.alive ? '❤️' : '💀'}</Text>
            </View>
          </FadeUp>
        ))}
        <Text style={[s.sub, { textAlign: 'center', marginTop: 6, marginBottom: 12 }]}>
          {anyGain ? 'Ratings are saved when you tap Play again or Main menu.' : 'No rating is awarded for this result.'}
        </Text>
        <Btn title={anyGain ? 'Save ratings & play again' : 'Play again (same players)'} onPress={() => { onAward(gains); onRematch(); }} style={s.wide} />
        <Btn title={anyGain ? 'Save ratings & main menu' : 'Main menu'} kind="ghost" sfx="deny" onPress={() => { onAward(gains); onExit(); }} style={s.wide} />
        <TouchableOpacity onPress={() => { Sound.play('deny'); onKeep(); }}><Text style={[s.link, { marginVertical: 8 }]}>Back to the game (don't save)</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/* ---------- styles ---------- */
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#14162b', paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  sub: { color: '#a9acc9', fontSize: 14 },
  link: { color: '#8ab4ff', fontSize: 16, fontWeight: '600' },
  label: { color: '#a9acc9', fontSize: 13, marginTop: 8, marginBottom: 4 },
  btn: { backgroundColor: '#5b6cff', paddingVertical: 14, borderRadius: 12, alignItems: 'center', paddingHorizontal: 16 },
  btnGhost: { backgroundColor: '#262a4d' },
  btnDanger: { backgroundColor: '#8a2432' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  wide: { width: '100%', marginBottom: 12 },
  small: { paddingVertical: 8, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1e2140', padding: 12, borderRadius: 14, marginBottom: 10, borderWidth: 2, borderColor: 'transparent' },
  rowOn: { borderColor: '#5b6cff' },
  rowText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginTop: 3 },
  footer: { padding: 16 },
  stepper: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2d3160', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#1a1d38', padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '90%' },
  input: { backgroundColor: '#262a4d', color: '#fff', borderRadius: 10, padding: 12, fontSize: 16, marginVertical: 8 },
  chip: { flex: 1, backgroundColor: '#262a4d', padding: 12, borderRadius: 10, alignItems: 'center' },
  chipTown: { backgroundColor: '#1f6b4a' },
  chipVill: { backgroundColor: '#7a1f2b' },
  card: { backgroundColor: '#1e2140', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  cardOn: { borderColor: '#5b6cff', backgroundColor: '#262a55' },
  cardName: { color: '#fff', fontWeight: '700', fontSize: 14, marginTop: 8, marginBottom: 2, textAlign: 'center' },
  badge: { position: 'absolute', top: -4, right: -8, width: 24, height: 24, borderRadius: 12, backgroundColor: '#2fbf84', alignItems: 'center', justifyContent: 'center' },
  miniStep: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#2d3160', alignItems: 'center', justifyContent: 'center' },
  modalFooter: { paddingTop: 10, borderTopWidth: 1, borderTopColor: '#2d3160' },
  stateBadge: { position: 'absolute', bottom: -6, right: -10, fontSize: 18 },
  muteBtn: { position: 'absolute', zIndex: 5, right: 16, top: Platform.OS === 'ios' ? 56 : (RNStatusBar.currentHeight || 24) + 12, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(12,8,24,0.6)', alignItems: 'center', justifyContent: 'center' },
  revealWrap: { alignItems: 'center', padding: 24, paddingTop: 16 },
  menuCard: { backgroundColor: 'rgba(12,8,24,0.72)', borderRadius: 20, padding: 16 },
  menuGhost: { backgroundColor: 'rgba(60,48,96,0.9)' },
});
