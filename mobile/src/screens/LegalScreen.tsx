import React from 'react';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useAuth } from '../auth';
import { Button, ErrorText, H1, Loading, Muted, Screen, useLoad } from '../components/ui';
import { Markdown } from '../components/Markdown';
import type { RootStackParamList } from '../navigation';

export default function LegalScreen() {
  const { name } = useRoute<RouteProp<RootStackParamList, 'Legal'>>().params;
  const { api } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.legal(name), [api, name]);
  if (loading) return <Loading />;
  if (!data) return <Screen><ErrorText>{error ?? 'Dokumen tidak ditemukan'}</ErrorText><Button title="Coba lagi" onPress={reload} /></Screen>;
  return (
    <Screen>
      <H1>{data.title}</H1>
      <Muted>Terakhir diperbarui: {data.updated}</Muted>
      <Markdown source={data.markdown} />
    </Screen>
  );
}
