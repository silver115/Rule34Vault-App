import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    Alert,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View
} from "react-native";
import { FontSize, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../contexts/AuthContext";
import { PreviewQuality, QUALITY_OPTIONS, ScrollMode, ViewingMode, useSettings } from "../contexts/SettingsContext";
import { ACCENT_COLORS, AccentColor, THEMES, ThemeName, useAppTheme } from "../contexts/ThemeContext";
import {
    getNotificationPref,
    registerForPushNotifications,
    registerWithPushServer,
    setNotificationPref,
    unregisterFromPushServer,
} from "../utils/notifications";

const THEME_KEYS = Object.keys(THEMES) as ThemeName[];
const QUALITY_KEYS = Object.keys(QUALITY_OPTIONS) as PreviewQuality[];

export default function SettingsScreen() {
  const router = useRouter();
  const { user, token: authToken, isLoggedIn, logout } = useAuth();
  const { themeName, colors, setTheme, accentColor, setAccent } = useAppTheme();
  const { previewQuality, qualityOption, setPreviewQuality, viewingMode, setViewingMode, scrollMode, setScrollMode } = useSettings();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [accentDropdownOpen, setAccentDropdownOpen] = useState(false);
  const [qualityDropdownOpen, setQualityDropdownOpen] = useState(false);
  const [viewModeOpen, setViewModeOpen] = useState(false);
  const [scrollModeOpen, setScrollModeOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    getNotificationPref().then(setPushEnabled).catch(() => {});
  }, []);

  async function handleTogglePush(value: boolean) {
    setPushLoading(true);
    try {
      if (value) {
        // Get push token from device
        const pushToken = await registerForPushNotifications();
        if (!pushToken && Platform.OS !== "web") {
          Alert.alert(
            "Permissions Required",
            "Please enable notifications in your device settings to receive feed updates."
          );
          return;
        }
        // Register with push server
        if (pushToken && authToken) {
          const result = await registerWithPushServer(pushToken, authToken);
          if (!result.ok) {
            const detail = result.error ? `\n\n${result.error}` : "";
            Alert.alert("Error", `Failed to register with notification server. Try again later.${detail}`);
            return;
          }
        }
      } else {
        // Unregister from push server
        if (authToken) {
          await unregisterFromPushServer(authToken);
        }
      }
      setPushEnabled(value);
      await setNotificationPref(value);
    } finally {
      setPushLoading(false);
    }
  }

  function handleSignOut() {
    if (Platform.OS === "web") {
      logout();
      router.replace("/");
    } else {
      Alert.alert("Sign Out", "Are you sure you want to sign out?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: () => {
            logout();
            router.replace("/");
          },
        },
      ]);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}> 
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.bgCard, borderBottomColor: colors.border }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Appearance Section */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Appearance</Text>
        <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
          <Pressable
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={() => setThemeDropdownOpen(true)}
          >
            <Ionicons name="color-palette-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Theme</Text>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                {THEMES[themeName].label} — {THEMES[themeName].description}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Theme Picker Modal */}
        <Modal
          visible={themeDropdownOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setThemeDropdownOpen(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setThemeDropdownOpen(false)}
          >
            <View style={[styles.modalContent, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Choose Theme</Text>
              {THEME_KEYS.map((key) => {
                const t = THEMES[key];
                const isActive = key === themeName;
                return (
                  <Pressable
                    key={key}
                    style={[
                      styles.themeOption,
                      { borderColor: colors.border },
                      isActive && { borderColor: colors.accent, backgroundColor: colors.accent + "15" },
                    ]}
                    onPress={() => {
                      setTheme(key);
                      setThemeDropdownOpen(false);
                    }}
                  >
                    <View style={styles.themePreview}>
                      <View style={[styles.previewDot, { backgroundColor: t.colors.bg }]} />
                      <View style={[styles.previewDot, { backgroundColor: t.colors.accent }]} />
                      <View style={[styles.previewDot, { backgroundColor: t.colors.accentLight }]} />
                      <View style={[styles.previewDot, { backgroundColor: t.colors.bgCard }]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.themeLabel, { color: colors.text }]}>
                        {t.label}
                        {isActive ? "  ✓" : ""}
                      </Text>
                      <Text style={[styles.themeSub, { color: colors.textMuted }]}>{t.description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>

        {/* Accent Color Section */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Personalization</Text>
        <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
          <Pressable
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={() => setAccentDropdownOpen(true)}
          >
            <Ionicons name="color-palette-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Accent Color</Text>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                {ACCENT_COLORS[accentColor].label} — Customize app colors
              </Text>
            </View>
            <View style={[styles.accentPreview, { backgroundColor: colors.accent }]} />
          </Pressable>
        </View>

        {/* Accent Color Picker Modal */}
        <Modal
          visible={accentDropdownOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setAccentDropdownOpen(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setAccentDropdownOpen(false)}
          >
            <View style={[styles.modalContent, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Choose Accent Color</Text>
              <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                Personalize your app's look
              </Text>
              {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((color) => {
                const accent = ACCENT_COLORS[color];
                const isActive = color === accentColor;
                return (
                  <Pressable
                    key={color}
                    style={[
                      styles.themeOption,
                      { borderColor: colors.border },
                      isActive && { borderColor: accent.color, backgroundColor: accent.color + "15" },
                    ]}
                    onPress={() => {
                      setAccent(color);
                      setAccentDropdownOpen(false);
                    }}
                  >
                    <View style={styles.accentIconWrap}>
                      <View style={[styles.accentPreview, { backgroundColor: accent.color }]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.themeLabel, { color: colors.text }]}>
                        {accent.label}
                        {isActive ? "  ✓" : ""}
                      </Text>
                      <Text style={[styles.themeSub, { color: colors.textMuted }]}>
                        {accent.color.toUpperCase()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>

        {/* Viewing Mode Section */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Browsing</Text>
        <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
          <Pressable
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={() => setViewModeOpen(true)}
          >
            <Ionicons name={viewingMode === "tiktok" ? "phone-portrait-outline" : "grid-outline"} size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Viewing Mode</Text>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                {viewingMode === "grid" ? "Grid — Classic thumbnail grid" : "TikTok — Full-screen swipe player"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Viewing Mode Picker Modal */}
        <Modal
          visible={viewModeOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setViewModeOpen(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setViewModeOpen(false)}
          >
            <View style={[styles.modalContent, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Viewing Mode</Text>
              <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                Choose how you browse posts
              </Text>
              {(["grid", "tiktok"] as ViewingMode[]).map((mode) => {
                const isActive = viewingMode === mode;
                const icon = mode === "grid" ? "grid-outline" : "phone-portrait-outline";
                const label = mode === "grid" ? "Grid" : "TikTok";
                const desc = mode === "grid"
                  ? "Classic thumbnail grid — tap any post to open full-screen TikTok player"
                  : "Full-screen vertical swipe with modern video player and scrubber";
                return (
                  <Pressable
                    key={mode}
                    style={[
                      styles.themeOption,
                      { borderColor: colors.border },
                      isActive && { borderColor: colors.accent, backgroundColor: colors.accent + "15" },
                    ]}
                    onPress={() => {
                      setViewingMode(mode);
                      setViewModeOpen(false);
                    }}
                  >
                    <View style={styles.qualityIconWrap}>
                      <Ionicons
                        name={icon}
                        size={20}
                        color={isActive ? colors.accent : colors.textSecondary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.themeLabel, { color: colors.text }]}>
                        {label}
                        {isActive ? "  ✓" : ""}
                      </Text>
                      <Text style={[styles.themeSub, { color: colors.textMuted }]}>{desc}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>

        {/* Scroll Mode Section */}
        <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
          <Pressable
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={() => setScrollModeOpen(true)}
          >
            <Ionicons name={scrollMode === "tiktok" ? "phone-portrait-outline" : "list-outline"} size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Scroll Mode</Text>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                {scrollMode === "default" ? "Default — Standard scrolling behavior" : "TikTok — Full-screen vertical swipe"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Scroll Mode Picker Modal */}
        <Modal
          visible={scrollModeOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setScrollModeOpen(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setScrollModeOpen(false)}
          >
            <View style={[styles.modalContent, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Scroll Mode</Text>
              <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                Choose how you scroll through posts (For You tab only)
              </Text>
              {(["default", "tiktok"] as ScrollMode[]).map((mode) => {
                const isActive = scrollMode === mode;
                const icon = mode === "default" ? "list-outline" : "phone-portrait-outline";
                const label = mode === "default" ? "Default" : "TikTok";
                const desc = mode === "default"
                  ? "Standard scrolling with grid and feed views"
                  : "Full-screen vertical swipe with modern video player";
                return (
                  <Pressable
                    key={mode}
                    style={[
                      styles.themeOption,
                      { borderColor: colors.border },
                      isActive && { borderColor: colors.accent, backgroundColor: colors.accent + "15" },
                    ]}
                    onPress={() => {
                      setScrollMode(mode);
                      setScrollModeOpen(false);
                    }}
                  >
                    <View style={styles.qualityIconWrap}>
                      <Ionicons
                        name={icon}
                        size={20}
                        color={isActive ? colors.accent : colors.textSecondary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.themeLabel, { color: colors.text }]}>
                        {label}
                        {isActive ? "  ✓" : ""}
                      </Text>
                      <Text style={[styles.themeSub, { color: colors.textMuted }]}>{desc}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>

        {/* Data & Quality Section */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Data & Quality</Text>
        <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
          <Pressable
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={() => setQualityDropdownOpen(true)}
          >
            <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Preview Quality</Text>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                {qualityOption.label} — {qualityOption.description}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Quality Picker Modal */}
        <Modal
          visible={qualityDropdownOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setQualityDropdownOpen(false)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setQualityDropdownOpen(false)}
          >
            <View style={[styles.modalContent, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Preview Quality</Text>
              <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                Lower quality uses less mobile data
              </Text>
              {QUALITY_KEYS.map((key) => {
                const opt = QUALITY_OPTIONS[key];
                const isActive = key === previewQuality;
                return (
                  <Pressable
                    key={key}
                    style={[
                      styles.themeOption,
                      { borderColor: colors.border },
                      isActive && { borderColor: colors.accent, backgroundColor: colors.accent + "15" },
                    ]}
                    onPress={() => {
                      setPreviewQuality(key);
                      setQualityDropdownOpen(false);
                    }}
                  >
                    <View style={styles.qualityIconWrap}>
                      <Ionicons
                        name={key === "low" ? "cellular-outline" : key === "medium" ? "cellular" : "wifi"}
                        size={20}
                        color={isActive ? colors.accent : colors.textSecondary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.themeLabel, { color: colors.text }]}>
                        {opt.label}
                        {isActive ? "  ✓" : ""}
                      </Text>
                      <Text style={[styles.themeSub, { color: colors.textMuted }]}>{opt.description}</Text>
                      {key === "low" && (
                        <Text style={[styles.qualityDetail, { color: colors.textMuted }]}>
                          Videos: tap to play • Images: thumbnails only
                        </Text>
                      )}
                      {key === "medium" && (
                        <Text style={[styles.qualityDetail, { color: colors.textMuted }]}>
                          Videos: auto-play • Images: full in detail view
                        </Text>
                      )}
                      {key === "high" && (
                        <Text style={[styles.qualityDetail, { color: colors.textMuted }]}>
                          Videos: auto-play • Images: full quality everywhere
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>

        {/* Notifications Section */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Notifications</Text>
        <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.text }]}>Push Notifications</Text>
              <Text style={[styles.rowSub, { color: colors.textMuted }]}>
                {pushEnabled
                  ? "You'll be notified of new feed posts"
                  : "Notifications are disabled"}
              </Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={handleTogglePush}
              disabled={pushLoading}
              trackColor={{ false: colors.bgTertiary, true: colors.accent + "66" }}
              thumbColor={pushEnabled ? colors.accent : colors.textMuted}
            />
          </View>
        </View>

        {/* Account Section */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Account</Text>
        <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
          <Pressable style={[styles.row, { borderBottomColor: colors.border }]} onPress={handleSignOut}>
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={[styles.rowLabel, { color: colors.danger }]}>Sign Out</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* App info */}
        <View style={styles.footerInfo}>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>Rule34Vault App v1.0.0</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === "web" ? Spacing.lg : 50,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: FontSize.xl,
    fontWeight: "700",
  },
  content: {
    padding: Spacing.md,
    paddingBottom: 100,
  },
  sectionLabel: {
    fontSize: FontSize.sm,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  card: {
    borderRadius: Radius.md,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderBottomWidth: 1,
  },
  rowLabel: {
    fontSize: FontSize.md,
    fontWeight: "500",
  },
  rowSub: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  footerInfo: {
    alignItems: "center",
    marginTop: Spacing.xl * 2,
  },
  footerText: {
    fontSize: FontSize.xs,
  },
  // Theme picker modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  modalContent: {
    width: "100%",
    maxWidth: 360,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: "700",
    marginBottom: Spacing.md,
  },
  themeOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    marginBottom: Spacing.sm,
  },
  themePreview: {
    flexDirection: "row",
    gap: 4,
  },
  previewDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  themeLabel: {
    fontSize: FontSize.md,
    fontWeight: "600",
  },
  themeSub: {
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  modalSubtitle: {
    fontSize: FontSize.sm,
    marginBottom: Spacing.md,
  },
  qualityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "center",
    alignItems: "center",
  },
  qualityDetail: {
    fontSize: 10,
    marginTop: 3,
  },
  accentPreview: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  accentIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    justifyContent: "center",
    alignItems: "center",
  },
});
