import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    FlatList,
    Platform,
    StyleSheet,
    View,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Post } from '../api/rule34vault';
import { useAuth } from '../contexts/AuthContext';
import { usePostList } from '../contexts/PostListContext';
import { TikTokView } from './TikTokView';

interface TikTokFeedProps {
  posts: Post[];
  onPostEnd?: (postId: number) => void;
  onPostError?: (postId: number) => void;
  onRefresh?: () => void;
  onLoadMore?: () => void;
  isLoading?: boolean;
  tabFocused?: boolean; // stops all playback when tab is not focused
}

export function TikTokFeed({ 
  posts, 
  onPostEnd, 
  onPostError, 
  onRefresh, 
  onLoadMore,
  isLoading,
  tabFocused = true,
}: TikTokFeedProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT } = useWindowDimensions();
  const { isLoggedIn } = useAuth();
  const { actionStates, updateActionState, ensureActionStates } = usePostList();

  // Prefetch action states for the active post and next 3 posts ahead
  useEffect(() => {
    if (!isLoggedIn || posts.length === 0) return;
    const ids = posts
      .slice(activeIndex, activeIndex + 4)
      .map(p => p.id);
    ensureActionStates(ids);
  }, [activeIndex, posts, isLoggedIn, ensureActionStates]);

  // Tab bar content height (set in _layout.tsx tabBarStyle.height)
  const TAB_BAR_HEIGHT = 56;
  // Estimated height — overridden by the measured value from onLayout
  const estimatedHeight = SCREEN_HEIGHT - TAB_BAR_HEIGHT - insets.bottom;
  const [itemHeight, setItemHeight] = useState(estimatedHeight);

  // Use the actual measured height of the container so item sizing is
  // device-accurate and not dependent on fragile window-dimension math.
  const handleContainerLayout = useCallback((e: any) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setItemHeight(h);
  }, []);

  // Handle viewable items change
  const handleViewableItemsChanged = useCallback(({ changed }: any) => {
    changed.forEach((item: any) => {
      if (item.isViewable) {
        setActiveIndex(item.index);
      }
    });
  }, []);

  // Handle post end (auto-scroll to next)
  const handlePostEnd = useCallback((postId: number) => {
    const currentIndex = posts.findIndex(post => post.id === postId);
    if (currentIndex !== -1 && currentIndex < posts.length - 1) {
      // Auto-scroll to next post
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: currentIndex + 1,
          animated: true,
        });
      }, 500);
    }
    onPostEnd?.(postId);
  }, [posts, onPostEnd]);

  // Handle post error
  const handlePostError = useCallback((postId: number) => {
    const currentIndex = posts.findIndex(post => post.id === postId);
    if (currentIndex !== -1 && currentIndex < posts.length - 1) {
      // Auto-scroll to next post after error
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: currentIndex + 1,
          animated: true,
        });
      }, 1000);
    }
    onPostError?.(postId);
  }, [posts, onPostError]);

  // Render individual post
  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => (
    <TikTokView
      post={item}
      isActive={index === activeIndex && tabFocused}
      onVideoEnd={() => handlePostEnd(item.id)}
      onVideoError={() => handlePostError(item.id)}
      initialActionState={actionStates[item.id]}
      onActionStateChange={updateActionState}
      containerHeight={itemHeight}
    />
  ), [activeIndex, tabFocused, handlePostEnd, handlePostError, actionStates, updateActionState, itemHeight]);

  // Key extractor
  const keyExtractor = useCallback((item: Post) => item.id.toString(), []);

  // Viewability config
  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
    minimumViewTime: 100,
  }).current;

  return (
    <View style={styles.container} onLayout={handleContainerLayout}>
      <FlatList
        ref={flatListRef}
        data={posts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal={false}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={handleViewableItemsChanged}
        onRefresh={onRefresh}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.5}
        refreshing={isLoading}
        getItemLayout={(data, index) => ({
          length: itemHeight,
          offset: itemHeight * index,
          index,
        })}
        overScrollMode="never"
        bounces={false}
        removeClippedSubviews={Platform.OS === 'android'}
        maxToRenderPerBatch={3}
        windowSize={3}
        initialNumToRender={1}
        style={{ borderWidth: 0, borderColor: 'transparent' }}
        contentContainerStyle={{ borderWidth: 0, borderColor: 'transparent' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
