import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View
} from "react-native";
import { Colors, FontSize, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../contexts/AuthContext";
import { useSite } from "../contexts/SiteContext";
import { useAppTheme } from "../contexts/ThemeContext";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const { isE621 } = useSite();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError(
        isE621
          ? "Please enter both username and API key"
          : "Please enter both email and password",
      );
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.back();
    } catch (e: any) {
      setError(e.message || "Login failed. Check your credentials.");
    } finally {
      setIsLoading(false);
    }
  }

  const { colors } = useAppTheme();

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        <View style={styles.header}>
          <Ionicons
            name={isE621 ? "paw" : "shield-checkmark"}
            size={48}
            color={isE621 ? "#00549f" : colors.accent}
          />
          <Text style={[styles.title, { color: colors.text }]}>
            {isE621 ? "e621" : "Rule34Vault"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {isE621
              ? "Sign in with your e621 account"
              : "Sign in to your account"}
          </Text>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>
              {error}
            </Text>
          </View>
        )}

        <View style={styles.form}>
          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: colors.bgTertiary,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name={isE621 ? "person-outline" : "mail-outline"}
              size={18}
              color={colors.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder={isE621 ? "e621 Username" : "Email"}
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType={isE621 ? "default" : "email-address"}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />
          </View>

          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: colors.bgTertiary,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name="lock-closed-outline"
              size={18}
              color={colors.textMuted}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, { color: colors.text, flex: 1 }]}
              placeholder={isE621 ? "API Key" : "Password"}
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />
            <Pressable
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeBtn}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
          </View>

          <Pressable
            style={[
              styles.loginBtn,
              { backgroundColor: colors.accent },
              isLoading && styles.loginBtnDisabled,
            ]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </Pressable>
        </View>

        <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
          Your credentials are stored securely on-device only.
        </Text>
        {isE621 && (
          <Pressable
            onPress={() => {
              if (Platform.OS === "web") {
                window.open("https://e621.net/users/home", "_blank");
              } else {
                const Linking = require("react-native").Linking;
                Linking.openURL("https://e621.net/users/home");
              }
            }}
            style={styles.apiKeyLink}
          >
            <Ionicons name="key-outline" size={14} color={colors.accent} />
            <Text style={[styles.apiKeyLinkText, { color: colors.accent }]}>
              Get your API key at e621.net
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  header: {
    alignItems: "center",
    marginBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: "800",
    color: Colors.text,
    marginTop: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "rgba(255,71,87,0.1)",
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(255,71,87,0.3)",
  },
  errorText: {
    color: Colors.danger,
    fontSize: FontSize.sm,
    flex: 1,
  },
  form: {
    gap: Spacing.md,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgTertiary,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 52,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSize.md,
    height: "100%",
  },
  eyeBtn: {
    padding: Spacing.xs,
  },
  loginBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  loginBtnText: {
    color: "#fff",
    fontSize: FontSize.lg,
    fontWeight: "700",
  },
  disclaimer: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    textAlign: "center",
    marginTop: Spacing.xl,
  },
  apiKeyLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: Spacing.md,
  },
  apiKeyLinkText: {
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
});
