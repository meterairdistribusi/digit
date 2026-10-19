import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

// Penampil Markdown ringan untuk dokumen hukum: "## judul", "- poin", **tebal**, paragraf. Tidak mengeksekusi HTML apa pun.
function Inline({ text, style }: { text: string; style?: object }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={style}>
      {parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text> : p))}
    </Text>
  );
}

export function Markdown({ source }: { source: string }) {
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  let para: string[] = [];
  let k = 0;
  const flush = () => {
    if (para.length) out.push(<Inline key={k++} text={para.join('\n')} style={s.p} />);
    if (bullets.length)
      out.push(
        <View key={k++} style={{ gap: 4 }}>
          {bullets.map((b, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={s.p}>•</Text>
              <Inline text={b} style={[s.p, { flex: 1 }]} />
            </View>
          ))}
        </View>
      );
    para = [];
    bullets = [];
  };
  for (const line of source.split('\n')) {
    if (!line.trim()) flush();
    else if (line.startsWith('## ')) { flush(); out.push(<Text key={k++} style={s.h} accessibilityRole="header">{line.slice(3)}</Text>); }
    else if (line.startsWith('- ')) { if (para.length) flush(); bullets.push(line.slice(2)); }
    else { if (bullets.length) flush(); para.push(line); }
  }
  flush();
  return <View style={{ gap: 10 }}>{out}</View>;
}

const s = StyleSheet.create({
  h: { fontSize: 17, fontWeight: '700', color: colors.fg, marginTop: 10 },
  p: { fontSize: 15, lineHeight: 22, color: colors.fg },
});
