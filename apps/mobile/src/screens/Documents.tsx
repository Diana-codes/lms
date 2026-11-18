import { DOCUMENT_INFO, type DocumentType } from '@kora/core';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api, errorMessage, openFile, uploadFile } from '../lib/api';
import { preparePhoto, uploadErrorMessage } from '../lib/upload';
import type { Documents, DocumentState } from '../lib/types';
import { Button, DarkCard, ErrorText, Muted, Panel, Sheet, tap } from '../ui';
import {
  AlertIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  DocumentIcon,
  IdCardIcon,
  ImageIcon,
  PlusIcon,
} from '../ui/icons';
import { c, font } from '../ui/theme';
import { BackBar } from './Tabs';

/** Matches the API's limit, so a big file is stopped before it is sent. */
const MAX_BYTES = 8 * 1024 * 1024;

const STATE: Record<DocumentState, { label: string; bg: string; fg: string }> = {
  MISSING: { label: 'Needed', bg: c['warning-bg'], fg: c['warning-fg'] },
  PENDING: { label: 'Being checked', bg: c['info-bg'], fg: c['info-fg'] },
  VERIFIED: { label: 'Verified', bg: c['success-bg'], fg: c['success-fg'] },
  REJECTED: { label: 'Send again', bg: c['danger-bg'], fg: c['danger-fg'] },
  EXPIRED: { label: 'Expired', bg: c['danger-bg'], fg: c['danger-fg'] },
  WAIVED: { label: 'Not needed', bg: c['neutral-bg'], fg: c['neutral-fg'] },
};

/** States where the borrower can (or must) send a file. */
const CAN_SEND: DocumentState[] = ['MISSING', 'REJECTED', 'EXPIRED', 'PENDING'];

type Picked = { uri: string; name: string; mimeType: string; size?: number };

function Pill({ state }: { state: DocumentState }) {
  const s = STATE[state];
  return (
    <View
      style={{ backgroundColor: s.bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}
    >
      <Text style={{ color: s.fg, fontSize: 12, fontFamily: font.semibold }}>{s.label}</Text>
    </View>
  );
}

function Option({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.option, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.optionIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontFamily: font.semibold, color: c.ink }}>{title}</Text>
        <Muted>{sub}</Muted>
      </View>
      <ChevronRightIcon size={18} color={c['ink-muted']} />
    </Pressable>
  );
}

/** A small text button under a document: View, Retake, Remove. */
function Action({
  label,
  hint,
  danger,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        danger && { borderColor: c['danger-bg'] },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text
        style={{
          fontSize: 13,
          fontFamily: font.semibold,
          color: danger ? c['danger-fg'] : c.forest,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The borrower's documents: what their application needs, what has been
 * received and checked, and why anything was sent back. Files can be a new
 * photo, a photo from the gallery, or a PDF (e.g. an RDB certificate).
 */
export function DocumentsScreen({
  onBack,
  toast,
}: {
  onBack: () => void;
  toast: (m: string) => void;
}) {
  const [data, setData] = useState<Documents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState<DocumentType | null>(null);
  const [busy, setBusy] = useState<DocumentType | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Documents>('/app/documents'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Photos are shrunk first; PDFs go as they are, if they fit. */
  async function send(type: DocumentType, file: Picked | (() => Promise<Picked>)) {
    setBusy(type);
    try {
      const ready = typeof file === 'function' ? await file() : file;
      if (ready.size != null && ready.size > MAX_BYTES) {
        toast('That PDF is over 8 MB. Try taking a photo of the document instead.');
        return;
      }
      setData(await uploadFile<Documents>(`/app/documents/${type}`, ready));
      toast(`${DOCUMENT_INFO[type].name} sent. We will check it and let you know.`);
    } catch (err) {
      toast(uploadErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function pick(type: DocumentType, how: 'camera' | 'library' | 'pdf') {
    setAdding(null);
    // Let the sheet close before the system picker opens over it.
    await new Promise((r) => setTimeout(r, 350));
    if (how === 'pdf') {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const a = res.assets[0]!;
      await send(type, {
        uri: a.uri,
        name: a.name.toLowerCase().endsWith('.pdf') ? a.name : `${a.name}.pdf`,
        mimeType: 'application/pdf',
        size: a.size,
      });
      return;
    }
    const perm =
      how === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast(
        how === 'camera'
          ? 'Allow camera access in Settings to take a photo.'
          : 'Allow photo access in Settings to choose a photo.',
      );
      return;
    }
    const res =
      how === 'camera'
        ? await ImagePicker.launchCameraAsync({
            cameraType:
              DOCUMENT_INFO[type].camera === 'front'
                ? ImagePicker.CameraType.front
                : ImagePicker.CameraType.back,
            quality: 0.7,
          })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled) return;
    const a = res.assets[0]!;
    await send(type, () => preparePhoto(a, type.toLowerCase()));
  }

  async function view(item: Documents['items'][number]) {
    if (!item.documentId) return;
    setOpening(item.documentId);
    try {
      const pdf = item.fileType === 'pdf';
      await openFile(
        `/app/documents/${item.documentId}/file`,
        `${item.type.toLowerCase()}-${item.documentId.slice(0, 8)}.${pdf ? 'pdf' : 'jpg'}`,
        pdf ? 'application/pdf' : 'image/jpeg',
      );
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setOpening(null);
    }
  }

  function remove(item: Documents['items'][number]) {
    const name = DOCUMENT_INFO[item.type].name;
    Alert.alert(
      `Remove your ${name}?`,
      'Nobody has checked it yet. You can send a new one any time.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy(item.type);
            try {
              setData(
                await api<Documents>(`/app/documents/${item.documentId}/remove`, {
                  method: 'POST',
                }),
              );
              toast(`${name} removed.`);
            } catch (err) {
              toast(errorMessage(err));
              void load();
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  const info = adding ? DOCUMENT_INFO[adding] : null;
  const replacing = adding
    ? Boolean(data?.items.find((i) => i.type === adding && i.documentId && adding !== 'OTHER'))
    : false;
  const done = data && data.needsAction === 0;

  return (
    <View style={{ flex: 1 }}>
      <BackBar title="Documents" onBack={onBack} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={c.forest}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!data && !error ? <ActivityIndicator color={c.forest} style={{ marginTop: 40 }} /> : null}
        {data ? (
          <>
            <DarkCard>
              <Text style={{ fontSize: 13, color: c['forest-muted'], fontFamily: font.body }}>
                {data.applicationCode
                  ? `For ${data.applicationCode} · ${data.productName}`
                  : 'To keep your account verified'}
              </Text>
              <Text style={{ fontFamily: font.display, fontSize: 24, color: c.surface }}>
                {done
                  ? 'You are all set'
                  : `${data.needsAction} ${data.needsAction === 1 ? 'document' : 'documents'} to send`}
              </Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    {
                      width: `${data.required ? Math.round((data.received / data.required) * 100) : 100}%`,
                    },
                  ]}
                />
              </View>
              <Text style={{ fontSize: 12, color: c['forest-muted'], fontFamily: font.body }}>
                {data.received} of {data.required} received
                {done ? '. We will tell you if anything else is needed.' : ''}
              </Text>
            </DarkCard>

            <View style={{ gap: 10 }}>
              {data.items.map((item) => {
                const doc = DOCUMENT_INFO[item.type];
                const canSend = CAN_SEND.includes(item.state);
                const sending = busy === item.type;
                const Icon =
                  item.type === 'NATIONAL_ID'
                    ? IdCardIcon
                    : item.type === 'SELFIE'
                      ? CameraIcon
                      : DocumentIcon;
                return (
                  <Panel key={item.type} style={{ gap: 10 }} radius={18}>
                    <Pressable
                      accessibilityRole={canSend ? 'button' : undefined}
                      accessibilityLabel={`${doc.name}, ${STATE[item.state].label}`}
                      accessibilityHint={canSend ? 'Opens the ways to send it' : undefined}
                      disabled={!canSend || busy != null}
                      onPress={() => {
                        tap();
                        setAdding(item.type);
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}
                    >
                      <View
                        style={[
                          styles.tile,
                          item.state === 'VERIFIED' && { backgroundColor: c['success-bg'] },
                        ]}
                      >
                        {item.state === 'VERIFIED' ? (
                          <CheckIcon size={18} color={c['success-fg']} />
                        ) : (
                          <Icon size={18} color={c.forest} />
                        )}
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontSize: 15, fontFamily: font.semibold, color: c.ink }}>
                          {doc.name}
                          {item.required ? '' : ' (extra)'}
                        </Text>
                        <Muted>
                          {sending
                            ? 'Uploading…'
                            : item.state === 'WAIVED'
                              ? 'Covered by your shared MoMo history'
                              : item.state === 'PENDING'
                                ? 'We have it and will check it soon.'
                                : item.state === 'VERIFIED'
                                  ? 'Checked and verified'
                                  : doc.hint}
                        </Muted>
                      </View>
                      {sending ? (
                        <ActivityIndicator color={c.forest} />
                      ) : (
                        <Pill state={item.state} />
                      )}
                    </Pressable>
                    {item.hasFile || (canSend && item.documentId) || item.canRemove ? (
                      <View style={styles.actions}>
                        {item.hasFile ? (
                          <Action
                            label={
                              opening === item.documentId
                                ? 'Opening…'
                                : item.fileType === 'pdf'
                                  ? 'View PDF'
                                  : 'View photo'
                            }
                            hint={`View the ${doc.name} you sent`}
                            disabled={opening != null}
                            onPress={() => view(item)}
                          />
                        ) : null}
                        {canSend && item.documentId ? (
                          <Action
                            label={doc.accepts === 'photo' ? 'Retake' : 'Replace'}
                            hint={`Send a new ${doc.name} in place of this one`}
                            disabled={busy != null}
                            onPress={() => setAdding(item.type)}
                          />
                        ) : null}
                        {item.canRemove ? (
                          <Action
                            label="Remove"
                            hint={`Remove the ${doc.name} you sent`}
                            danger
                            disabled={busy != null}
                            onPress={() => remove(item)}
                          />
                        ) : null}
                      </View>
                    ) : null}
                    {item.reason ? (
                      <View style={styles.reason}>
                        <AlertIcon size={16} color={c['danger-fg']} />
                        <Text
                          style={{ flex: 1, color: c['danger-fg'], fontSize: 13, lineHeight: 18 }}
                        >
                          {item.reason}
                        </Text>
                      </View>
                    ) : null}
                  </Panel>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                tap();
                setAdding('OTHER');
              }}
              disabled={busy != null}
              style={({ pressed }) => [styles.addOther, pressed && { opacity: 0.7 }]}
            >
              <PlusIcon size={18} color={c.forest} />
              <Text style={{ fontSize: 15, fontFamily: font.semibold, color: c.forest }}>
                {busy === 'OTHER' ? 'Uploading…' : 'Send another document'}
              </Text>
            </Pressable>
            <Muted style={{ textAlign: 'center' }}>
              Photos or PDFs up to 8 MB. Your documents are stored in Rwanda and only seen by Kora
              Lend staff checking your application.
            </Muted>
          </>
        ) : null}
      </ScrollView>

      <Sheet
        open={adding != null}
        onClose={() => setAdding(null)}
        title={`${replacing ? 'Replace' : 'Add'} ${info?.name ?? ''}`}
      >
        {adding && info ? (
          <>
            <Muted style={{ fontSize: 14, lineHeight: 20 }}>
              {replacing
                ? `The new file takes the place of the one you sent. ${info.hint}`
                : info.hint}
            </Muted>
            <View style={{ gap: 10 }}>
              <Option
                icon={<CameraIcon size={20} color={c.forest} />}
                title={adding === 'SELFIE' ? 'Take a selfie' : 'Take a photo'}
                sub={adding === 'SELFIE' ? 'Uses your front camera' : 'Lay it flat in good light'}
                onPress={() => pick(adding, 'camera')}
              />
              {adding !== 'SELFIE' ? (
                <Option
                  icon={<ImageIcon size={20} color={c.forest} />}
                  title="Choose a photo"
                  sub="From your gallery"
                  onPress={() => pick(adding, 'library')}
                />
              ) : null}
              {info.accepts === 'photo-or-pdf' ? (
                <Option
                  icon={<DocumentIcon size={20} color={c.forest} />}
                  title="Choose a PDF"
                  sub="From your files, email or WhatsApp downloads"
                  onPress={() => pick(adding, 'pdf')}
                />
              ) : null}
            </View>
            <Button label="Cancel" variant="ghost" height={48} onPress={() => setAdding(null)} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  track: {
    height: 8,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: 99, backgroundColor: c.lime },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: c.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 52 },
  action: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reason: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: c['danger-bg'],
    borderRadius: 12,
    padding: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: c['success-bg'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  addOther: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.dashed,
  },
});
