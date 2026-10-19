import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Product, rupiah } from '../api';
import { createStyles, radius, space, useTheme } from '../theme';
import { Badge } from './ui';
import { ProductImage } from './ProductImage';

const useS = createStyles((colors) => ({
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  tags: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between' },
  disc: { backgroundColor: '#e11d48', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)', color: '#fff', fontWeight: '800', fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, overflow: 'hidden' },
  label: { backgroundColor: 'rgba(255,255,255,0.95)', color: '#3b2fd1', fontWeight: '800', fontSize: 11.5, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, overflow: 'hidden' },
  body: { padding: space.md, gap: 3 },
  cat: { color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  name: { color: colors.fg, fontWeight: '700', fontSize: 15, lineHeight: 20 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6, marginTop: 4 },
  price: { color: colors.fg, fontWeight: '800', fontSize: 17 },
  was: { color: colors.muted, fontSize: 12.5, textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6 },
  sold: { color: colors.muted, fontSize: 12 },
  dim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(15,17,30,0.55)', alignItems: 'center', justifyContent: 'center' },
  dimText: { color: '#fff', fontWeight: '800', fontSize: 15 },
}));

export function ProductCard({ p, onPress, width }: { p: Product; onPress: () => void; width?: number }) {
  const s = useS();
  useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${p.name}, ${rupiah(p.price)}${p.discount_percent ? `, diskon ${p.discount_percent} persen` : ''}${p.orderable ? '' : ', stok habis'}`}
      style={({ pressed }) => [s.card, width ? { width } : { flex: 1 }, pressed && { opacity: 0.88 }]}>
      <View>
        <ProductImage product={p} scale={0.55} />
        <View style={s.tags} pointerEvents="none">
          {p.discount_percent ? <Text style={s.disc}>-{p.discount_percent}%</Text> : <View />}
          {p.badge ? <Text style={s.label}>{p.badge}</Text> : null}
        </View>
        {!p.orderable ? <View style={s.dim}><Text style={s.dimText}>Stok habis</Text></View> : null}
      </View>
      <View style={s.body}>
        <Text style={s.cat}>{p.category}</Text>
        <Text style={s.name} numberOfLines={2}>{p.name}</Text>
        <View style={s.priceRow}>
          <Text style={s.price}>{rupiah(p.price)}</Text>
          {p.compare_at ? <Text style={s.was}>{rupiah(p.compare_at)}</Text> : null}
        </View>
        <View style={s.meta}>
          {p.orderable ? <Badge text={p.low_stock ? 'Stok terbatas' : 'Tersedia'} tone={p.low_stock ? 'warn' : 'ok'} /> : <Badge text="Habis" tone="bad" />}
          {p.sold >= 5 ? <Text style={s.sold}>{p.sold}+ terjual</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}
