import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Image, Modal,
  StyleSheet, SafeAreaView, ScrollView, Alert, Platform, StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useKeepAwake } from 'expo-keep-awake';

/* ---------- constants & helpers ---------- */
const PLAYERS_KEY = 'ww_players_v1';
const ROLES_KEY = 'ww_roles_v1';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const DEFAULT_ROLES = [
  { id: 'villager', name: 'Villager', team: 'Townie', emoji: '🧑‍🌾', icon: null, builtIn: true,
    desc: 'An ordinary townsperson with no special power. Find the werewolves and vote them out.' },
  { id: 'doctor', name: 'Doctor', team: 'Townie', emoji: '🩺', icon: null, builtIn: true,
    desc: 'Each night, choose one player to protect from the werewolves.' },
  { id: 'seer', name: 'Seer', team: 'Townie', emoji: '🔮', icon: null, builtIn: true,
    desc: 'Each night, point at a player and the moderator tells you if they are a villain.' },
  { id: 'werewolf', name: 'Werewolf', team: 'Villain', emoji: '🐺', icon: null, builtIn: true,
    desc: 'Each night, the werewolves agree on one player to eliminate. Blend in during the day.' },
  { id: 'avenger', name: 'Avenger', team: 'Townie', emoji: '🗡️', icon: null, builtIn: true,
    desc: 'If you are eliminated, you may take one player down with you.' },
];

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
        if (p) setPlayers(JSON.parse(p));
        if (r) setRoles(JSON.parse(r));
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
        setScreen('game');
      }} />
  );
  else if (screen === 'game' && game) body = <Game game={game} setGame={setGame} onExit={() => { setGame(null); setScreen('home'); }} />;

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
    <View style={[s.center, { padding: 24 }]}>
      <Text style={{ fontSize: 72 }}>🐺</Text>
      <Text style={[s.title, { fontSize: 30, marginBottom: 4 }]}>Werewolf</Text>
      <Text style={[s.sub, { marginBottom: 32 }]}>Moderator Companion</Text>
      <Btn title="New Game" onPress={onNew} style={s.wide} />
      <Btn title="Players Library" kind="ghost" onPress={() => go('library')} style={s.wide} />
      <Btn title="Available Roles" kind="ghost" onPress={() => go('roles')} style={s.wide} />
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
    const clean = { ...editing, name };
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
  const blank = { name: '', team: 'Townie', desc: '', emoji: '⭐', icon: null };
  return (
    <View style={{ flex: 1 }}>
      <Header title="Available Roles" onBack={onBack} right={<TouchableOpacity onPress={() => setEditing(blank)}><Text style={s.link}>＋ Add</Text></TouchableOpacity>} />
      <FlatList
        data={roles} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => setEditing({ ...item })} onLongPress={() => remove(item)}>
            <Avatar uri={item.icon} fallback={item.emoji} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowText}>{item.name}</Text>
              <Text style={s.sub} numberOfLines={2}>{item.desc}</Text>
            </View>
            <Tag team={item.team} />
          </TouchableOpacity>
        )}
      />
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={s.modalWrap}>
          <ScrollView style={s.modal} keyboardShouldPersistTaps="handled">
            {editing && (<>
              <Text style={[s.title, { marginBottom: 12 }]}>{editing.id ? 'Edit Role' : 'Add Role'}</Text>
              <TouchableOpacity onPress={async () => { const u = await pickImage(); if (u) setEditing({ ...editing, icon: u }); }} style={{ alignSelf: 'center' }}>
                <Avatar uri={editing.icon} fallback={editing.emoji} size={96} />
                <Text style={[s.link, { textAlign: 'center', marginTop: 6 }]}>{editing.icon ? 'Change picture' : 'Upload picture / icon'}</Text>
              </TouchableOpacity>
              {editing.icon && <TouchableOpacity onPress={() => setEditing({ ...editing, icon: null })}><Text style={[s.sub, { textAlign: 'center' }]}>Remove picture</Text></TouchableOpacity>}
              <Text style={s.label}>Emoji (used when no picture)</Text>
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
              <TextInput style={[s.input, { height: 100, textAlignVertical: 'top' }]} multiline placeholder="What does this role do?" placeholderTextColor="#777" value={editing.desc} onChangeText={(t) => setEditing({ ...editing, desc: t })} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn title="Cancel" kind="ghost" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                <Btn title="Save" onPress={save} style={{ flex: 1 }} />
              </View>
              {editing.id && editing.id !== 'villager' && <Btn title="Delete role" kind="danger" onPress={() => remove(editing)} style={{ marginTop: 10 }} />}
            </>)}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const Tag = ({ team }) => (
  <View style={[s.tag, { backgroundColor: team === 'Villain' ? '#7a1f2b' : '#1f6b4a' }]}>
    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{team}</Text>
  </View>
);

/* ---------- new game: pick players ---------- */
function PickPlayers({ players, selected, setSelected, onBack, onNext, goLibrary }) {
  const n = players.filter((p) => selected[p.id]).length;
  const allOn = players.length > 0 && n === players.length;
  return (
    <View style={{ flex: 1 }}>
      <Header title="Select Players" onBack={onBack}
        right={players.length ? <TouchableOpacity onPress={() => { const m = {}; if (!allOn) players.forEach((p) => (m[p.id] = true)); setSelected(m); }}><Text style={s.link}>{allOn ? 'None' : 'All'}</Text></TouchableOpacity> : null} />
      <FlatList
        data={players} keyExtractor={(p) => p.id} contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 40 }}>
            <Text style={s.sub}>Your library is empty.</Text>
            <Btn title="Add players" onPress={goLibrary} style={{ marginTop: 12 }} />
          </View>}
        renderItem={({ item }) => {
          const on = !!selected[item.id];
          return (
            <TouchableOpacity style={[s.row, on && s.rowOn]} onPress={() => setSelected({ ...selected, [item.id]: !on })}>
              <Avatar uri={item.photo} fallback={item.name[0]?.toUpperCase()} />
              <Text style={[s.rowText, { flex: 1 }]}>{item.name}</Text>
              <Text style={{ fontSize: 24 }}>{on ? '✅' : '⬜'}</Text>
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

/* ---------- new game: assign roles ---------- */
function AssignRoles({ roles, counts, setCounts, total, onBack, onReset, onStart }) {
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
        data={roles} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={s.row}>
            <Avatar uri={item.icon} fallback={item.emoji} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowText}>{item.name}</Text>
              <Tag team={item.team} />
            </View>
            <TouchableOpacity style={s.stepper} onPress={() => change(item.id, -1)}><Text style={s.stepText}>−</Text></TouchableOpacity>
            <Text style={[s.rowText, { width: 28, textAlign: 'center' }]}>{counts[item.id] || 0}</Text>
            <TouchableOpacity style={s.stepper} onPress={() => change(item.id, 1)}><Text style={s.stepText}>＋</Text></TouchableOpacity>
          </View>
        )}
      />
      <View style={s.footer}>
        {!ok && <Text style={[s.sub, { textAlign: 'center', color: '#ff8a8a', marginBottom: 6 }]}>Total roles must equal {total}.</Text>}
        {ok && wolves === 0 && <Text style={[s.sub, { textAlign: 'center', color: '#ffcf70', marginBottom: 6 }]}>No villains in this game!</Text>}
        <Btn title="Start Game" onPress={onStart} disabled={!ok} />
      </View>
    </View>
  );
}

/* ---------- game (moderator) ---------- */
function Game({ game, setGame, onExit }) {
  useKeepAwake();
  const [phase, setPhase] = useState('night');
  const [day, setDay] = useState(1);
  const [discussMins, setDiscussMins] = useState(5);
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const [reveal, setReveal] = useState(true);
  const [info, setInfo] = useState(null);
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

  const toDay = () => { setPhase('day'); setLeft(discussMins * 60); setRunning(true); };
  const toNight = () => { setPhase('night'); setRunning(false); setDay(day + 1); };
  const toggleAlive = (i) => setGame({ assignments: game.assignments.map((a, k) => (k === i ? { ...a, alive: !a.alive } : a)) });

  const alive = game.assignments.filter((a) => a.alive);
  const villains = alive.filter((a) => a.role.team === 'Villain').length;
  const towns = alive.length - villains;
  const winner = villains === 0 ? 'Townies win! 🎉' : villains >= towns ? 'Villains win! 🐺' : null;

  const bg = night ? '#0d1030' : '#3a2f12';
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <Header title={night ? `🌙 Night ${day}` : `☀️ Day ${day}`}
        onBack={() => Alert.alert('End game?', 'Return to the main menu?', [{ text: 'Cancel', style: 'cancel' }, { text: 'End', style: 'destructive', onPress: onExit }])} />

      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
        {night ? (
          <>
            <Text style={{ fontSize: 56 }}>🌙</Text>
            <Text style={s.sub}>Everyone close your eyes…</Text>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 56, color: '#fff', fontWeight: '800', fontVariant: ['tabular-nums'] }}>{mmss(left)}</Text>
            <Text style={s.sub}>{left === 0 ? "Time's up — vote!" : running ? 'Discussion time' : 'Paused'}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Btn title={running ? 'Pause' : 'Resume'} kind="ghost" disabled={left === 0} onPress={() => setRunning(!running)} style={s.small} />
              <Btn title="+1 min" kind="ghost" onPress={() => setLeft(left + 60)} style={s.small} />
              <Btn title="Reset" kind="ghost" onPress={() => { setLeft(discussMins * 60); setRunning(false); }} style={s.small} />
            </View>
          </>
        )}
        {night && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <Text style={s.sub}>Discussion timer:</Text>
            <TouchableOpacity style={s.stepper} onPress={() => setDiscussMins(Math.max(1, discussMins - 1))}><Text style={s.stepText}>−</Text></TouchableOpacity>
            <Text style={s.rowText}>{discussMins} min</Text>
            <TouchableOpacity style={s.stepper} onPress={() => setDiscussMins(discussMins + 1)}><Text style={s.stepText}>＋</Text></TouchableOpacity>
          </View>
        )}
      </View>

      {winner && <Text style={{ color: '#ffd66b', textAlign: 'center', fontSize: 20, fontWeight: '800', marginBottom: 6 }}>{winner}</Text>}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 }}>
        <Text style={s.sub}>Alive {alive.length} · 🐺 {villains} · 🏘️ {towns}</Text>
        <TouchableOpacity onPress={() => setReveal(!reveal)}><Text style={s.link}>{reveal ? 'Hide roles' : 'Show roles'}</Text></TouchableOpacity>
      </View>

      <FlatList
        data={game.assignments} keyExtractor={(a) => a.player.id} contentContainerStyle={{ padding: 16 }}
        renderItem={({ item, index }) => (
          <TouchableOpacity style={[s.row, !item.alive && { opacity: 0.4 }]} onPress={() => toggleAlive(index)} onLongPress={() => setInfo(item.role)}>
            <Avatar uri={item.player.photo} fallback={item.player.name[0]?.toUpperCase()} />
            <View style={{ flex: 1 }}>
              <Text style={[s.rowText, !item.alive && { textDecorationLine: 'line-through' }]}>{item.player.name}</Text>
              {reveal && <Text style={s.sub}>{item.role.emoji} {item.role.name}</Text>}
            </View>
            {reveal && <Tag team={item.role.team} />}
            <Text style={{ fontSize: 20, marginLeft: 8 }}>{item.alive ? '❤️' : '💀'}</Text>
          </TouchableOpacity>
        )}
      />
      <Text style={[s.sub, { textAlign: 'center' }]}>Tap = alive/dead · Long-press = role info</Text>

      <View style={s.footer}>
        {night ? <Btn title="☀️ Turn to Day" onPress={toDay} /> : <Btn title="🌙 Turn to Night" onPress={toNight} />}
      </View>

      <Modal visible={!!info} transparent animationType="fade" onRequestClose={() => setInfo(null)}>
        <View style={s.modalWrap}>
          <View style={s.modal}>
            {info && (<>
              <View style={{ alignItems: 'center' }}>
                <Avatar uri={info.icon} fallback={info.emoji} size={90} />
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
});
