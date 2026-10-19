import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { Product } from '../api';

// Gambar produk dengan sampul bergradasi (dua warna + nama) bila belum ada gambar atau gagal dimuat.
// `scale` mengatur ukuran teks sampul: ~0.5 untuk kartu kecil, 1 untuk gambar besar.
export function Cover({ product, scale = 1 }: { product: Product; scale?: number }) {
  const { c1, c2, title, subtitle } = product.cover;
  const n = title.length;
  const size = (n <= 5 ? 44 : n <= 7 ? 32 : n <= 9 ? 26 : 21) * scale;
  return (
    <View style={[s.fill, { backgroundColor: c1 }]}>
      <View style={[s.circle, { width: '70%', aspectRatio: 1, right: '-18%', top: '-30%', backgroundColor: c2, opacity: 0.55 }]} />
      <View style={[s.circle, { width: '55%', aspectRatio: 1, left: '-16%', bottom: '-34%', backgroundColor: c2, opacity: 0.4 }]} />
      <Text style={[s.title, { fontSize: size }]} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
      {subtitle ? <Text style={[s.sub, { fontSize: 15 * scale + 2 }]} numberOfLines={1}>{subtitle}</Text> : null}
    </View>
  );
}

export function ProductImage({ product, scale = 1 }: { product: Product; scale?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={s.box} accessible accessibilityRole="image" accessibilityLabel={product.name}>
      {product.image && !failed ? (
        <Image source={{ uri: product.image }} style={s.fill} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <Cover product={product} scale={scale} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { width: '100%', aspectRatio: 4 / 3, overflow: 'hidden', backgroundColor: '#e8e9f2' },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  circle: { position: 'absolute', borderRadius: 999 },
  title: { color: '#fff', fontWeight: '800', maxWidth: '86%' },
  sub: { color: '#fff', fontWeight: '600', opacity: 0.92, marginTop: 2, maxWidth: '86%' },
});
