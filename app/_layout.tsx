import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../contexts/AuthContext";
import { PostListProvider } from "../contexts/PostListContext";
import { PlaylistProvider } from "../contexts/PlaylistContext";
import { FeedCountProvider } from "../contexts/FeedCountContext";
import { AppThemeProvider, useAppTheme } from "../contexts/ThemeContext";
import { Colors } from "../constants/theme";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

function ThemedApp() {
  const { colors } = useAppTheme();

  const navTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: colors.bg,
      card: colors.bgSecondary,
      text: colors.text,
      border: colors.border,
      primary: colors.accent,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="login"
          options={{ title: "Login", presentation: "modal" }}
        />
        <Stack.Screen
          name="post/[id]"
          options={{
            title: "",
            headerShown: false,
            animation: "fade",
          }}
        />
        <Stack.Screen name="playlist/[id]" options={{ title: "Playlist" }} />
        <Stack.Screen name="tag/[id]" options={{ title: "Tag" }} />
        <Stack.Screen name="user-posts" options={{ title: "Posts" }} />
        <Stack.Screen name="user-playlists" options={{ title: "My Playlists" }} />
        <Stack.Screen name="user/[username]" options={{ title: "User" }} />
        <Stack.Screen name="followed-playlists" options={{ title: "Followed Playlists" }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
    <AuthProvider>
      <FeedCountProvider>
      <PlaylistProvider>
      <PostListProvider>
        <ThemedApp />
      </PostListProvider>
      </PlaylistProvider>
      </FeedCountProvider>
    </AuthProvider>
    </AppThemeProvider>
  );
}
