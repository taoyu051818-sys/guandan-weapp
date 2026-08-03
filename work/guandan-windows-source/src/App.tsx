import { useEffect, useRef } from 'react';
import { useGameStore } from './store/gameStore';
import { MainMenu } from './pages/MainMenu';
import { GroupingPhase } from './pages/GroupingPhase';
import { GameBoard } from './pages/GameBoard';
import { SettingsModal } from './components/ui/SettingsModal';
import { TutorialModal } from './components/ui/TutorialModal';

import { Settlement } from './pages/Settlement';
import { Lobby } from './pages/Lobby';
import { audioManager } from './lib/audio';
import { socket, connectSocket } from './lib/socket';
import type { GameState } from './types/game';
import { toSyncedGameState, type JoinedRoomPayload, type StateSyncPacket, type SyncedGameState } from './lib/multiplayerSync';
import { setRuleProfileByPreset } from './lib/rules';

function App() {
  const status = useGameStore(state => state.status);
  const settings = useGameStore(state => state.settings);
  const isMultiplayer = useGameStore(state => state.isMultiplayer);
  const roomId = useGameStore(state => state.roomId);
  const myPlayerId = useGameStore(state => state.myPlayerId);
  const setGameState = useGameStore(state => state.setGameState);
  const hostSyncVersionRef = useRef(0);

  useEffect(() => {
    // 监听全局交互事件以启动背景音乐（绕过浏览器的自动播放限制）
    const handleInteraction = () => {
      if (settings) {
        audioManager.setConfig(settings.soundEnabled, settings.volume, settings.bgmEnabled, settings.bgmVolume);
        audioManager.preloadVoice(); // 交互时立即唤醒并预热语音引擎
        setRuleProfileByPreset(settings.rulePreset);
      }
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };

    if (settings) {
      document.body.classList.toggle('compact-theme', settings.visualTheme === 'compact');
      setRuleProfileByPreset(settings.rulePreset);
    }

    document.addEventListener('click', handleInteraction);
    document.addEventListener('keydown', handleInteraction);

    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };
  }, [settings]);

  useEffect(() => {
    if (!isMultiplayer) return;
    connectSocket();

    const handleStateUpdated = (payload: SyncedGameState | StateSyncPacket) => {
      const nextState = (payload as StateSyncPacket).state
        ? (payload as StateSyncPacket).state
        : (payload as SyncedGameState);
      setGameState(nextState as Partial<GameState>);
    };

    const handleRejoinedRoom = (payload: JoinedRoomPayload) => {
      setGameState({
        ...payload.state,
        isMultiplayer: true,
        roomId: payload.roomId,
        myPlayerId: payload.myPlayerId,
      } as Partial<GameState>);
      if (payload.myPlayerId === 'p1') {
        hostSyncVersionRef.current = payload.version ?? 0;
      }
    };

    const handleHostLeft = () => {
      setGameState({ status: 'menu', isMultiplayer: false, roomId: null });
    };

    const handleReconnect = () => {
      const { isMultiplayer: mp, roomId: rid, myPlayerId: pid } = useGameStore.getState();
      if (!mp || !rid || !pid) return;
      socket.emit('rejoinRoom', rid, pid);
    };

    socket.on('stateUpdated', handleStateUpdated);
    socket.on('rejoinedRoom', handleRejoinedRoom);
    socket.on('hostLeft', handleHostLeft);
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('stateUpdated', handleStateUpdated);
      socket.off('rejoinedRoom', handleRejoinedRoom);
      socket.off('hostLeft', handleHostLeft);
      socket.off('connect', handleReconnect);
    };
  }, [isMultiplayer, setGameState]);

  useEffect(() => {
    if (!isMultiplayer || myPlayerId !== 'p1' || !roomId) return;

    const emitHostState = (syncedState: SyncedGameState) => {
      hostSyncVersionRef.current += 1;
      const packet: StateSyncPacket = { state: syncedState, version: hostSyncVersionRef.current };
      socket.emit('updateState', roomId, packet);
    };

    const unsubscribe = useGameStore.subscribe((nextState, prevState) => {
      // 仅在状态发生变化时同步，降低无效广播
      if (nextState !== prevState) {
        emitHostState(toSyncedGameState(nextState));
      }
    });
    hostSyncVersionRef.current = 0;
    emitHostState(toSyncedGameState(useGameStore.getState()));
    return () => unsubscribe();
  }, [isMultiplayer, myPlayerId, roomId]);

  return (
    <div className="w-screen h-screen overflow-hidden text-gray-800 antialiased font-sans relative">
      {status === 'menu' && <MainMenu />}
      {status === 'lobby' && <Lobby />}
      {status === 'grouping' && <GroupingPhase />}
      {(status === 'playing' || status === 'dealing' || status === 'tribute') && <GameBoard />}
      {status === 'settlement' && <Settlement />}
      {/* 可以扩展结算界面等 */}

      <SettingsModal />
      <TutorialModal />
    </div>
  );
}

export default App;
