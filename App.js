import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Image, ImageBackground, Modal, Switch, useWindowDimensions,
  StyleSheet, SafeAreaView, ScrollView, Alert, Platform, StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useKeepAwake } from 'expo-keep-awake';

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
};

/* ---------- constants & helpers ---------- */
const PLAYERS_KEY = 'ww_players_v1';
const ROLES_KEY = 'ww_roles_v1';
const SEED_KEY = 'ww_roles_seed_v3';
const PSEED_KEY = 'ww_players_seed_v1';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// hasAction = wakes up at night. order = who is called first (lower = earlier).
// targets = how many players the role picks each night.
const mk = (id, name, team, emoji, hasAction, order, targets, nightPrompt, desc) => ({
  id, name, team, emoji, icon: null, builtIn: true, hasAction, order, targets, nightPrompt, desc,
  canTargetSame: team !== 'Villain',
});
const DEFAULT_ROLES = [
  mk('villager', 'Villager', 'Townie', '🧑‍🌾', false, 50, 1, '',
    'An ordinary townsperson with no special power. Find the werewolves and vote them out.'),
  mk('doctor', 'Doctor', 'Townie', '🩺', true, 6, 1, 'Doctor, wake up. Who do you want to protect tonight?',
    'Each night, choose one player to protect from the werewolves.'),
  mk('jester', 'Jester', 'Townie', '🃏', false, 50, 1, '',
    'You want to be voted out! Fool the town into eliminating you. (Moderator decides what happens if you win.)'),
  mk('avenger', 'Avenger', 'Townie', '🗡️', false, 50, 1, '',
    'If you are eliminated, you may take one player down with you.'),
  mk('werewolf', 'Werewolf', 'Villain', '🐺', true, 3, 1, 'Werewolves, wake up. Who do you want to eliminate tonight?',
    'Each night, the werewolves agree on one player to eliminate. Blend in during the day.'),
  mk('police', 'Police', 'Townie', '👮', true, 1, 1, 'Police, wake up. Who do you want to arrest tonight?',
    'Each night, arrest one player. An arrested player cannot use their night ability that night.'),
  mk('mayor', 'Mayor', 'Townie', '🎩', false, 50, 1, '',
    'Your vote counts as two votes during the day discussion and voting.'),
  mk('hunter', 'Hunter', 'Townie', '🤠', false, 50, 1, '',
    'When you are eliminated, you immediately shoot and eliminate one player of your choice.'),
  mk('vampire', 'Vampire', 'Villain', '🧛', true, 4, 1, 'Vampire, wake up. Who do you want to bite tonight?',
    'Each night, bite one player to drain or turn them. The moderator decides the effect of the bite.'),
  mk('bodyguard', 'Bodyguard', 'Townie', '🕶️', true, 5, 1, 'Bodyguard, wake up. Who do you want to guard tonight?',
    'Each night, guard one player. If the werewolves attack them, you die in their place.'),
  mk('seer', 'Seer', 'Townie', '🔮', true, 7, 1, 'Seer, wake up. Who do you want to check tonight?',
    'Each night, point at a player and the moderator tells you if they are a villain.'),
  mk('transporter', 'Transporter', 'Townie', '🌀', true, 2, 2, 'Transporter, wake up. Which two players do you want to swap tonight?',
    'Each night, choose two players to swap places. Any night action aimed at one hits the other instead.'),
];

// Makes roles saved by an older version of the app compatible (adds the new fields).
const normalizeRoles = (saved) => {
  const defaults = {};
  DEFAULT_ROLES.forEach((r) => (defaults[r.id] = r));
  return saved.map((r) => {
    const d = defaults[r.id];
    const base = { hasAction: false, order: 50, targets: 1, nightPrompt: '', canTargetSame: true };
    if (d) { base.hasAction = d.hasAction; base.order = d.order; base.targets = d.targets; base.nightPrompt = d.nightPrompt; base.canTargetSame = d.canTargetSame; }
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
  put('werewolf', Math.max(1, Math.round(n / 4)));
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

// Builds the list of roles the moderator must wake up tonight (only roles with living holders).
const buildNightSteps = (assignments) => {
  const map = {};
  assignments.forEach((a) => {
    if (!a.alive || !a.role.hasAction) return;
    if (!map[a.role.id]) map[a.role.id] = { role: a.role, holders: [] };
    map[a.role.id].holders.push(a.player);
  });
  return Object.values(map).sort((x, y) => (x.role.order ?? 50) - (y.role.order ?? 50));
};

/* ---------- small UI pieces ---------- */
const Btn = ({ title, onPress, kind = 'primary', disabled, style }) => (
  <TouchableOpacity
    onPress={onPress} disabled={disabled} activeOpacity={0.8}
    style={[s.btn, kind === 'ghost' && s.btnGhost, kind === 'danger' && s.btnDanger, disabled && { opacity: 0.4 }, style]}>
    <Text style={s.btnText}>{title}</Text>
  </TouchableOpacity>
);

const Avatar = ({ uri, fallback, size = 48 }) =>
  uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#333' }} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#2d2f45', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.5, color: '#fff' }}>{fallback}</Text>
    </View>
  );

// Role picture: your uploaded picture > default asset picture > emoji
const RoleAvatar = ({ role, size = 48 }) => {
  const r = size * 0.22;
  if (role.icon) return <Image source={{ uri: role.icon }} style={{ width: size, height: size, borderRadius: r, backgroundColor: '#333' }} />;
  if (ROLE_ASSETS[role.id]) return <Image source={ROLE_ASSETS[role.id]} resizeMode="contain" style={{ width: size, height: size }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: '#2d2f45', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.5, color: '#fff' }}>{role.emoji || '⭐'}</Text>
    </View>
  );
};

const Tag = ({ team }) => (
  <View style={[s.tag, { backgroundColor: team === 'Villain' ? '#7a1f2b' : '#1f6b4a' }]}>
    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{team}</Text>
  </View>
);

const Header = ({ title, onBack, right }) => (
  <View style={s.header}>
    {onBack ? <TouchableOpacity onPress={onBack} style={{ width: 60 }}><Text style={s.link}>‹ Back</Text></TouchableOpacity> : <View style={{ width: 60 }} />}
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

  useEffect(() => {
    (async () => {
      try {
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
        setRoles(list);
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);
  useEffect(() => { if (loaded) AsyncStorage.setItem(PLAYERS_KEY, JSON.stringify(players)).catch(() => {}); }, [players, loaded]);
  useEffect(() => { if (loaded) AsyncStorage.setItem(ROLES_KEY, JSON.stringify(roles)).catch(() => {}); }, [roles, loaded]);

  const selectedPlayers = useMemo(() => players.filter((p) => selected[p.id]), [players, selected]);

  let body = null;
  if (!loaded) body = <View style={s.center}><Text style={s.sub}>Loading…</Text></View>;
  else if (screen === 'home') body = <Home go={setScreen} onNew={() => { setSelected({}); setScreen('pick'); }} />;
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
        setGame({ assignments: selectedPlayers.map((p, i) => ({ player: p, role: shuffled[i], alive: true })) });
        setScreen('reveal');
      }} />
  );
  else if (screen === 'reveal' && game) body = (
    <RevealRoles game={game}
      onCancel={() => { setGame(null); setScreen('assign'); }}
      onDone={() => setScreen('game')} />
  );
  else if (screen === 'game' && game) body = <Game game={game} setGame={setGame} onExit={() => { setGame(null); setScreen('home'); }} onRematch={() => { setGame(null); setScreen('assign'); }} />;

  if (loaded && screen === 'home') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <StatusBar style="light" translucent />
        {body}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      {body}
    </SafeAreaView>
  );
}

/* ---------- home ---------- */
function Home({ go, onNew }) {
  return (
    <ImageBackground source={WALLPAPER} resizeMode="cover" style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'flex-end', padding: 20, paddingBottom: Platform.OS === 'ios' ? 184 : 168 }}>
        <View style={s.menuCard}>
          <Btn title="New Game" onPress={onNew} style={[s.wide, { backgroundColor: '#e0952b' }]} />
          <Btn title="Players Library" kind="ghost" onPress={() => go('library')} style={[s.wide, s.menuGhost]} />
          <Btn title="Available Roles" kind="ghost" onPress={() => go('roles')} style={[s.wide, s.menuGhost, { marginBottom: 0 }]} />
        </View>
      </View>
    </ImageBackground>
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
            <Avatar uri={item.photo} fallback={item.name[0]?.toUpperCase()} />
            <Text style={[s.rowText, { flex: 1 }]}>{item.name}</Text>
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
              <TouchableOpacity onPress={async () => { const u = await pickImage(); if (u) setEditing({ ...editing, photo: u }); }} style={{ alignSelf: 'center' }}>
                <Avatar uri={editing.photo} fallback="📷" size={96} />
                <Text style={[s.link, { textAlign: 'center', marginTop: 6 }]}>{editing.photo ? 'Change picture' : 'Upload picture'}</Text>
              </TouchableOpacity>
              <TextInput style={s.input} placeholder="Player name" placeholderTextColor="#777" value={editing.name} onChangeText={(t) => setEditing({ ...editing, name: t })} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn title="Cancel" kind="ghost" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                <Btn title="Save" onPress={save} style={{ flex: 1 }} />
              </View>
              {editing.id && <Btn title="Delete player" kind="danger" onPress={() => { const p = editing; setEditing(null); remove(p); }} style={{ marginTop: 10 }} />}
            </>)}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---------- available roles ---------- */
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
  const blank = { name: '', team: 'Townie', desc: '', emoji: '⭐', icon: null, hasAction: false, order: 50, targets: 1, nightPrompt: '', canTargetSame: true };
  return (
    <View style={{ flex: 1 }}>
      <Header title="Available Roles" onBack={onBack} right={<TouchableOpacity onPress={() => setEditing(blank)}><Text style={s.link}>＋ Add</Text></TouchableOpacity>} />
      <FlatList
        data={roles} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => setEditing({ ...item })} onLongPress={() => remove(item)}>
            <RoleAvatar role={item} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowText}>{item.name}{item.hasAction ? '  🌙' : ''}</Text>
              <Text style={s.sub} numberOfLines={2}>{item.desc}</Text>
            </View>
            <Tag team={item.team} />
          </TouchableOpacity>
        )}
      />
      <Text style={[s.sub, { textAlign: 'center', padding: 8 }]}>🌙 = has a night action · Tap to edit</Text>
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={s.modalWrap}>
          <ScrollView style={s.modal} keyboardShouldPersistTaps="handled">
            {editing && (<>
              <Text style={[s.title, { marginBottom: 12 }]}>{editing.id ? 'Edit Role' : 'Add Role'}</Text>
              <TouchableOpacity onPress={async () => { const u = await pickImage(); if (u) setEditing({ ...editing, icon: u }); }} style={{ alignSelf: 'center' }}>
                <RoleAvatar role={editing} size={96} />
                <Text style={[s.link, { textAlign: 'center', marginTop: 6 }]}>{editing.icon ? 'Change picture' : 'Upload picture / icon'}</Text>
              </TouchableOpacity>
              {editing.icon && <TouchableOpacity onPress={() => setEditing({ ...editing, icon: null })}><Text style={[s.sub, { textAlign: 'center' }]}>Remove my picture (use default)</Text></TouchableOpacity>}
              <Text style={s.label}>Emoji (used when there is no picture)</Text>
              <TextInput style={s.input} value={editing.emoji} maxLength={4} onChangeText={(t) => setEditing({ ...editing, emoji: t })} />
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
                <Text style={s.label}>What the moderator asks at night</Text>
                <TextInput style={[s.input, { height: 70, textAlignVertical: 'top' }]} multiline placeholder="e.g. Doctor, wake up. Who do you want to protect?" placeholderTextColor="#777" value={editing.nightPrompt} onChangeText={(t) => setEditing({ ...editing, nightPrompt: t })} />
              </>)}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <Btn title="Cancel" kind="ghost" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                <Btn title="Save" onPress={save} style={{ flex: 1 }} />
              </View>
              {editing.id && editing.id !== 'villager' && <Btn title="Delete role" kind="danger" onPress={() => remove(editing)} style={{ marginTop: 10, marginBottom: 20 }} />}
            </>)}
          </ScrollView>
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
function PickPlayers({ players, selected, setSelected, onBack, onNext, goLibrary }) {
  const { cols, gap, cardW } = useGrid();
  const n = players.filter((p) => selected[p.id]).length;
  const allOn = players.length > 0 && n === players.length;
  return (
    <View style={{ flex: 1 }}>
      <Header title="Select Players" onBack={onBack}
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
            <TouchableOpacity activeOpacity={0.85} style={[s.card, { width: cardW, marginBottom: gap }, on && s.cardOn]}
              onPress={() => setSelected({ ...selected, [item.id]: !on })}>
              <View>
                <Avatar uri={item.photo} fallback={item.name[0]?.toUpperCase()} size={Math.min(72, cardW - 40)} />
                {on && <View style={s.badge}><Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text></View>}
              </View>
              <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
            </TouchableOpacity>
          );
        }}
      />
      <View style={s.footer}>
        <Text style={[s.sub, { textAlign: 'center', marginBottom: 8 }]}>{n} player{n === 1 ? '' : 's'} selected (min 4)</Text>
        <Btn title="Next" onPress={onNext} disabled={n < 4} />
      </View>
    </View>
  );
}

/* ---------- new game: assign roles (cards) ---------- */
function AssignRoles({ roles, counts, setCounts, total, onBack, onReset, onStart }) {
  const { cols, gap, cardW } = useGrid();
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  const ok = sum === total;
  const wolves = roles.filter((r) => r.team === 'Villain').reduce((a, r) => a + (counts[r.id] || 0), 0);
  const change = (id, d) => setCounts({ ...counts, [id]: Math.max(0, (counts[id] || 0) + d) });
  return (
    <View style={{ flex: 1 }}>
      <Header title="Confirm Roles" onBack={onBack} right={<TouchableOpacity onPress={onReset}><Text style={s.link}>Auto</Text></TouchableOpacity>} />
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={[s.sub, { textAlign: 'center' }]}>
          Roles set: <Text style={{ color: ok ? '#6ee7a8' : '#ff8a8a', fontWeight: '700' }}>{sum} / {total}</Text> players
        </Text>
      </View>
      <FlatList
        key={cols} numColumns={cols} columnWrapperStyle={{ gap }}
        data={roles} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => {
          const c = counts[item.id] || 0;
          return (
            <View style={[s.card, { width: cardW, marginBottom: gap }, c > 0 && s.cardOn]}>
              <RoleAvatar role={item} size={Math.min(64, cardW - 30)} />
              <Text style={s.cardName} numberOfLines={1}>{item.name}{item.hasAction ? ' 🌙' : ''}</Text>
              <View style={{ alignSelf: 'center' }}><Tag team={item.team} /></View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <TouchableOpacity style={s.miniStep} onPress={() => change(item.id, -1)}><Text style={s.stepText}>−</Text></TouchableOpacity>
                <Text style={[s.rowText, { minWidth: 20, textAlign: 'center' }]}>{c}</Text>
                <TouchableOpacity style={s.miniStep} onPress={() => change(item.id, 1)}><Text style={s.stepText}>＋</Text></TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
      <View style={s.footer}>
        {!ok && <Text style={[s.sub, { textAlign: 'center', color: '#ff8a8a', marginBottom: 6 }]}>Total roles must equal {total}.</Text>}
        {ok && wolves === 0 && <Text style={[s.sub, { textAlign: 'center', color: '#ffcf70', marginBottom: 6 }]}>No villains in this game!</Text>}
        <Btn title="Confirm & Hand Out Roles" onPress={onStart} disabled={!ok} />
      </View>
    </View>
  );
}

/* ---------- pass the device: each player checks their own role ---------- */
function RevealRoles({ game, onCancel, onDone }) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const total = game.assignments.length;
  const a = game.assignments[i];
  const last = i === total - 1;

  const confirmCancel = () =>
    Alert.alert('Cancel role reveal?', 'Roles will be dealt again next time.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: onCancel },
    ]);

  const next = () => {
    setShown(false);
    if (last) onDone(); else setI(i + 1);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={`Player ${i + 1} / ${total}`} onBack={confirmCancel} />
      {!shown ? (
        <View style={[s.center, { padding: 24 }]}>
          <Text style={[s.sub, { marginBottom: 12 }]}>Pass the device to</Text>
          <Avatar uri={a.player.photo} fallback={a.player.name[0]?.toUpperCase()} size={130} />
          <Text style={[s.title, { fontSize: 32, marginVertical: 14 }]}>{a.player.name}</Text>
          <Text style={[s.sub, { textAlign: 'center', marginBottom: 28 }]}>Make sure nobody else is looking at the screen.</Text>
          <Btn title="Show my role" onPress={() => setShown(true)} style={s.wide} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ alignItems: 'center', padding: 24 }}>
          <Text style={[s.sub, { marginBottom: 10 }]}>{a.player.name}, your role is</Text>
          <RoleAvatar role={a.role} size={150} />
          <Text style={[s.title, { fontSize: 34, marginTop: 14 }]}>{a.role.name}</Text>
          <Tag team={a.role.team} />
          <Text style={[s.rowText, { fontWeight: '400', textAlign: 'center', marginVertical: 18 }]}>{a.role.desc || 'No description.'}</Text>
          {a.role.hasAction && <Text style={[s.sub, { textAlign: 'center', marginBottom: 14 }]}>🌙 You will be woken up at night by the moderator.</Text>}
          <Btn title={last ? 'Hide role & start the game' : 'Hide role & pass to next player'} onPress={next} style={s.wide} />
        </ScrollView>
      )}
    </View>
  );
}

/* ---------- game (moderator) ---------- */
function Game({ game, setGame, onExit, onRematch }) {
  useKeepAwake();
  const [phase, setPhase] = useState('night');
  const [day, setDay] = useState(1);
  const [steps, setSteps] = useState(() => buildNightSteps(game.assignments));
  const [stepIdx, setStepIdx] = useState(0);
  const [actions, setActions] = useState({});      // roleId -> playerId | 'none'
  const [showHolders, setShowHolders] = useState(false);
  const [lastNight, setLastNight] = useState('');
  const [discussMins, setDiscussMins] = useState(5);
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const [reveal, setReveal] = useState(false);     // roles hidden by default
  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const [hadVillains] = useState(() => game.assignments.some((a) => a.role.team === 'Villain'));
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

  const find = (pid) => game.assignments.find((a) => a.player.id === pid);
  const aliveList = game.assignments.filter((a) => a.alive);

  // Police arrest: the arrested player's night action is blocked if they are the only holder of that role.
  const blockedId = (() => { const p = actions.police; return p && p[0] && p[0] !== 'none' ? p[0] : null; })();
  const isBlocked = (st) => !!blockedId && st.role.id !== 'police' && st.holders.every((h) => h.id === blockedId);
  const effective = (rid) => {
    const st = steps.find((x) => x.role.id === rid);
    if (!st || isBlocked(st)) return null;
    return actions[rid] || null;
  };

  // What happened tonight (werewolf target vs doctor / bodyguard, with transporter swaps)
  const outcome = () => {
    const sw = effective('transporter');
    const swapOn = sw && sw.length === 2 && !sw.includes('none');
    const swap = (id) => (!swapOn ? id : id === sw[0] ? sw[1] : id === sw[1] ? sw[0] : id);
    const tgt = (rid) => { const t = effective(rid); return t && t[0] && t[0] !== 'none' ? swap(t[0]) : null; };
    const wolf = tgt('werewolf'); const doc = tgt('doctor'); const bg = tgt('bodyguard');
    let victim = null; let saved = false; let guarded = null;
    if (wolf) {
      if (doc === wolf) saved = true;
      else if (bg === wolf) {
        const g = game.assignments.find((x) => x.alive && x.role.id === 'bodyguard');
        if (g) { victim = g; guarded = find(wolf); } else victim = find(wolf);
      } else victim = find(wolf);
    }
    return { victim, saved, guarded };
  };

  const toDay = () => {
    const { victim } = outcome();
    if (victim) {
      setGame({ assignments: game.assignments.map((a) => (a.player.id === victim.player.id ? { ...a, alive: false } : a)) });
      setLastNight(`${victim.player.name} was eliminated during the night.`);
    } else {
      setLastNight('Nobody died last night.');
    }
    setPhase('day');
    setLeft(discussMins * 60);
    setRunning(true);
  };

  const toNight = () => {
    setPhase('night');
    setRunning(false);
    setDay(day + 1);
    setSteps(buildNightSteps(game.assignments));
    setStepIdx(0);
    setActions({});
    setShowHolders(false);
  };

  const toggleAlive = (i) => setGame({ assignments: game.assignments.map((a, k) => (k === i ? { ...a, alive: !a.alive } : a)) });

  const villains = aliveList.filter((a) => a.role.team === 'Villain').length;
  const towns = aliveList.length - villains;
  const winner = !hadVillains ? null
    : aliveList.length === 0 ? 'Nobody wins 🤝'
    : villains === 0 ? 'Townies win! 🎉'
    : villains >= towns ? 'Villains win! 🐺' : null;
  useEffect(() => { if (!winner) setDismissed(null); }, [winner]);

  const inSteps = night && stepIdx < steps.length;
  const step = inSteps ? steps[stepIdx] : null;
  const rid = step ? step.role.id : null;
  // roles with canTargetSame === false (e.g. werewolf) cannot pick players holding the same role
  const targetList = step ? aliveList.filter((a) => step.role.canTargetSame !== false || a.role.id !== rid) : [];
  const need = step ? Math.max(1, Math.min(step.role.targets || 1, targetList.length)) : 1;
  const picks = step ? (actions[rid] || []) : [];
  const ready = picks.includes('none') || picks.length === need;
  const toggle = (pid) => {
    let next;
    if (need === 1) next = [pid];
    else {
      const cur = picks.filter((x) => x !== 'none');
      next = cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid].slice(-need);
    }
    setActions({ ...actions, [rid]: next });
  };
  const blockedHere = !!step && isBlocked(step);
  const seerTarget = step && rid === 'seer' && !blockedHere && picks[0] && picks[0] !== 'none' ? find(picks[0]) : null;
  const goStep = (d) => { setStepIdx(stepIdx + d); setShowHolders(false); };

  const bg = night ? '#0d1030' : '#3a2f12';
  const out = night && !inSteps ? outcome() : null;

  if (winner && dismissed !== winner) {
    return <GameOver winner={winner} assignments={game.assignments} onKeep={() => setDismissed(winner)} onRematch={onRematch} onExit={onExit} />;
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
              <RoleAvatar role={step.role} size={84} />
              <Text style={[s.title, { marginTop: 6 }]}>{step.role.name}</Text>
              <Text style={[s.rowText, { fontWeight: '400', textAlign: 'center', marginTop: 8 }]}>
                “{step.role.nightPrompt || `${step.role.name}, wake up. Who do you choose?`}”
              </Text>
              <TouchableOpacity onPress={() => setShowHolders(!showHolders)} style={{ marginTop: 8 }}>
                <Text style={s.link}>{showHolders ? `Playing: ${step.holders.map((p) => p.name).join(', ')}` : 'Show who has this role'}</Text>
              </TouchableOpacity>
            </View>

            {blockedHere && (
              <View style={[s.row, { backgroundColor: '#5a3b12' }]}>
                <Text style={[s.rowText, { flex: 1 }]}>⛔ {find(blockedId).player.name} was arrested — this action is blocked tonight.</Text>
              </View>
            )}
            <Text style={[s.label, { marginLeft: 4 }]}>{need > 1 ? `Choose ${need} players (${picks.filter((x) => x !== 'none').length}/${need})` : 'Chosen player'}</Text>
            {step.role.canTargetSame === false && <Text style={[s.sub, { marginLeft: 4, marginBottom: 6 }]}>Players with the same role can't be chosen.</Text>}
            {targetList.map((a) => {
              const on = picks.includes(a.player.id);
              return (
                <TouchableOpacity key={a.player.id} style={[s.row, on && s.rowOn]} onPress={() => toggle(a.player.id)}>
                  <Avatar uri={a.player.photo} fallback={a.player.name[0]?.toUpperCase()} />
                  <Text style={[s.rowText, { flex: 1 }]}>{a.player.name}</Text>
                  {on && <Text style={{ fontSize: 22 }}>🎯</Text>}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={[s.row, picks.includes('none') && s.rowOn]} onPress={() => setActions({ ...actions, [rid]: ['none'] })}>
              <Text style={[s.rowText, { flex: 1 }]}>No one / skip</Text>
              {picks.includes('none') && <Text style={{ fontSize: 22 }}>🎯</Text>}
            </TouchableOpacity>

            {seerTarget && (
              <View style={[s.row, { justifyContent: 'center', backgroundColor: seerTarget.role.team === 'Villain' ? '#5a1b25' : '#1b4d38' }]}>
                <Text style={s.rowText}>
                  🔮 {seerTarget.player.name} is a {seerTarget.role.team === 'Villain' ? 'VILLAIN 🐺' : 'TOWNIE 🏘️'}
                </Text>
              </View>
            )}
          </ScrollView>
          <View style={[s.footer, { flexDirection: 'row', gap: 10 }]}>
            {stepIdx > 0 && <Btn title="‹ Back" kind="ghost" onPress={() => goStep(-1)} style={{ flex: 1 }} />}
            <Btn title={stepIdx === steps.length - 1 ? 'Finish night' : 'Next role ›'} onPress={() => goStep(1)} disabled={!ready} style={{ flex: 2 }} />
          </View>
        </>
      )}

      {/* ---------- NIGHT: summary ---------- */}
      {night && !inSteps && (
        <>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 48 }}>🌙</Text>
              <Text style={s.title}>Night summary</Text>
              <Text style={s.sub}>Only you (the moderator) should see this.</Text>
            </View>
            {steps.length === 0 && <Text style={[s.sub, { textAlign: 'center' }]}>No roles with a night action are alive.</Text>}
            {steps.map((st) => {
              const ids = (actions[st.role.id] || []).filter((x) => x !== 'none');
              const t = ids.length ? find(ids[0]) : null;
              const names = ids.map((id) => find(id).player.name).join(st.role.id === 'transporter' ? ' ↔ ' : ', ');
              return (
                <View key={st.role.id} style={s.row}>
                  <RoleAvatar role={st.role} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowText}>{st.role.name}</Text>
                    <Text style={s.sub}>{isBlocked(st) ? '⛔ Arrested — action blocked' : t ? `→ ${names}${st.role.id === 'seer' ? ` (${t.role.team})` : ''}` : '→ No one'}</Text>
                  </View>
                </View>
              );
            })}
            <View style={[s.row, { backgroundColor: '#2b2250' }]}>
              <Text style={[s.rowText, { flex: 1 }]}>
                {out.victim ? (out.guarded ? `🛡️ ${out.victim.player.name} will die protecting ${out.guarded.player.name}.` : `💀 ${out.victim.player.name} will be eliminated.`) : out.saved ? '🩺 The doctor saved the werewolves’ target. Nobody dies.' : 'Nobody will die tonight.'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}>
              <Text style={s.sub}>Discussion timer:</Text>
              <TouchableOpacity style={s.stepper} onPress={() => setDiscussMins(Math.max(1, discussMins - 1))}><Text style={s.stepText}>−</Text></TouchableOpacity>
              <Text style={s.rowText}>{discussMins} min</Text>
              <TouchableOpacity style={s.stepper} onPress={() => setDiscussMins(discussMins + 1)}><Text style={s.stepText}>＋</Text></TouchableOpacity>
            </View>
          </ScrollView>
          <View style={[s.footer, { flexDirection: 'row', gap: 10 }]}>
            {steps.length > 0 && <Btn title="‹ Back" kind="ghost" onPress={() => goStep(-1)} style={{ flex: 1 }} />}
            <Btn title="☀️ Turn to Day" onPress={toDay} style={{ flex: 2 }} />
          </View>
        </>
      )}

      {/* ---------- DAY ---------- */}
      {!night && (
        <>
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            {!!lastNight && <Text style={[s.rowText, { marginBottom: 6, textAlign: 'center', paddingHorizontal: 16 }]}>{lastNight}</Text>}
            <Text style={{ fontSize: 56, color: '#fff', fontWeight: '800', fontVariant: ['tabular-nums'] }}>{mmss(left)}</Text>
            <Text style={s.sub}>{left === 0 ? "Time's up — vote!" : running ? 'Discussion time' : 'Paused'}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Btn title={running ? 'Pause' : 'Resume'} kind="ghost" disabled={left === 0} onPress={() => setRunning(!running)} style={s.small} />
              <Btn title="+1 min" kind="ghost" onPress={() => setLeft(left + 60)} style={s.small} />
              <Btn title="Reset" kind="ghost" onPress={() => { setLeft(discussMins * 60); setRunning(false); }} style={s.small} />
            </View>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 }}>
            <Text style={s.sub}>Alive {aliveList.length}</Text>
            <TouchableOpacity onPress={() => setReveal(!reveal)}><Text style={s.link}>{reveal ? 'Hide roles' : 'Show roles'}</Text></TouchableOpacity>
          </View>

          <FlatList
            data={game.assignments} keyExtractor={(a) => a.player.id} contentContainerStyle={{ padding: 16 }}
            extraData={reveal}
            renderItem={({ item, index }) => (
              <TouchableOpacity style={[s.row, !item.alive && { opacity: 0.4 }]} onPress={() => toggleAlive(index)} onLongPress={() => setInfo(item.role)}>
                <Avatar uri={item.player.photo} fallback={item.player.name[0]?.toUpperCase()} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowText, !item.alive && { textDecorationLine: 'line-through' }]}>{item.player.name}</Text>
                  {reveal && <Text style={s.sub}>{item.role.name}</Text>}
                </View>
                {reveal && <RoleAvatar role={item.role} size={32} />}
                {reveal && <Tag team={item.role.team} />}
                <Text style={{ fontSize: 20, marginLeft: 8 }}>{item.alive ? '❤️' : '💀'}</Text>
              </TouchableOpacity>
            )}
          />
          <Text style={[s.sub, { textAlign: 'center' }]}>Tap = alive/dead · Long-press = role info (moderator)</Text>
          <View style={s.footer}>
            <Btn title="🌙 Turn to Night" onPress={toNight} />
          </View>
        </>
      )}

      <Modal visible={!!info} transparent animationType="fade" onRequestClose={() => setInfo(null)}>
        <View style={s.modalWrap}>
          <View style={s.modal}>
            {info && (<>
              <View style={{ alignItems: 'center' }}>
                <RoleAvatar role={info} size={90} />
                <Text style={[s.title, { marginTop: 8 }]}>{info.name}</Text>
                <Tag team={info.team} />
              </View>
              <Text style={[s.rowText, { marginVertical: 14, fontWeight: '400' }]}>{info.desc || 'No description.'}</Text>
              <Btn title="Close" onPress={() => setInfo(null)} />
            </>)}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---------- game over ---------- */
function GameOver({ winner, assignments, onKeep, onRematch, onExit }) {
  const townWin = winner.startsWith('Townies');
  const none = winner.startsWith('Nobody');
  return (
    <View style={{ flex: 1, backgroundColor: townWin ? '#12351f' : none ? '#25262e' : '#3a1018' }}>
      <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
        <Text style={{ fontSize: 64, marginTop: 10 }}>{townWin ? '🎉' : none ? '🤝' : '🐺'}</Text>
        <Text style={[s.title, { fontSize: 30, marginVertical: 6, textAlign: 'center' }]}>{winner}</Text>
        <Text style={[s.sub, { marginBottom: 16 }]}>Game over — here is who everyone was</Text>
        {assignments.map((a) => (
          <View key={a.player.id} style={[s.row, { width: '100%' }, !a.alive && { opacity: 0.65 }]}>
            <Avatar uri={a.player.photo} fallback={a.player.name[0]?.toUpperCase()} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowText}>{a.player.name}</Text>
              <Text style={s.sub}>{a.role.name}</Text>
            </View>
            <RoleAvatar role={a.role} size={36} />
            <Tag team={a.role.team} />
            <Text style={{ fontSize: 20 }}>{a.alive ? '❤️' : '💀'}</Text>
          </View>
        ))}
        <Btn title="Play again (same players)" onPress={onRematch} style={[s.wide, { marginTop: 10 }]} />
        <Btn title="Main menu" kind="ghost" onPress={onExit} style={s.wide} />
        <TouchableOpacity onPress={onKeep}><Text style={[s.link, { marginVertical: 8 }]}>Back to the game</Text></TouchableOpacity>
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
  menuCard: { backgroundColor: 'rgba(12,8,24,0.72)', borderRadius: 20, padding: 16 },
  menuGhost: { backgroundColor: 'rgba(60,48,96,0.9)' },
});