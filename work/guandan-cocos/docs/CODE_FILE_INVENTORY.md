# 逐文件代码健康清单

由 `node scripts/audit-code-health.mjs` 只读生成。

范围：Cocos 运行源码、共享规则源码、权威服务端 JS；不含构建产物、第三方素材和归档工程。

runtime=语法级保守入口可达（不等同于打包器最终保留）；type-only=仅类型可达；retained-entry=明确保留的兼容/工具入口；review=需人工核对，不能据此直接删除。

测试提及数是静态文本关联，**不是测试覆盖率**。large-file >600 行；高入度/出度 ≥18。生成规则只改 shared-core，不能直接改 generated。

| 范围 | 文件 | 行数 | 运行入口可达 | 待核对 |
| --- | ---: | ---: | ---: | ---: |
| client | 211 | 30007 | 205 | 0 |
| core | 37 | 6689 | 35 | 0 |
| server | 71 | 10378 | 69 | 0 |

| 文件 | 行数 | 状态 | 入/出依赖 | 测试提及 | 维护提醒 | 开发建议 |
| --- | ---: | --- | --- | ---: | --- | --- |
| shared-core/src/ai/candidates.ts | 115 | runtime | 3/6 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/checkpoint.ts | 56 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/config.ts | 70 | runtime | 1/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/decisionRunner.ts | 365 | runtime | 1/11 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/decisionSupport.ts | 467 | runtime | 4/6 | 3 | — | 可按现有职责扩展 |
| shared-core/src/ai/engine.ts | 255 | runtime | 2/14 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/fallbackDecision.ts | 184 | runtime | 1/7 | 2 | — | 可按现有职责扩展 |
| shared-core/src/ai/index.ts | 2 | runtime | 3/2 | 6 | — | 可按现有职责扩展 |
| shared-core/src/ai/policyOverrides.ts | 189 | runtime | 2/11 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/random.ts | 49 | runtime | 4/0 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/resourceProtection.ts | 126 | runtime | 2/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/ruleMemo.ts | 118 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/runtimeIntel.ts | 189 | runtime | 6/2 | 3 | — | 可按现有职责扩展 |
| shared-core/src/ai/scoring.ts | 199 | runtime | 8/3 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/search.ts | 533 | runtime | 3/4 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/simulation.ts | 39 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/strategies/hard.ts | 197 | runtime | 1/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/strategies/master.ts | 599 | runtime | 1/4 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/strategies/medium.ts | 111 | runtime | 1/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/strategies/profiles.ts | 61 | runtime | 2/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/types.ts | 152 | type-only | 18/3 | 0 | high-fan-in, no-direct-test-mention | 稳定契约，检查调用方 |
| shared-core/src/ai/workerProtocol.ts | 93 | runtime | 2/3 | 2 | — | 可按现有职责扩展 |
| shared-core/src/ai/workerRuntime.ts | 62 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| shared-core/src/hints/handHintPolicy.ts | 105 | runtime | 1/4 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/hints/model.ts | 37 | runtime | 2/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/index.ts | 15 | runtime | 0/15 | 6 | — | 可按现有职责扩展 |
| shared-core/src/lib/ai.ts | 1 | retained-entry | 0/1 | 3 | — | 保留兼容/工具边界 |
| shared-core/src/lib/deck.ts | 93 | runtime | 3/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/lib/engine.ts | 408 | runtime | 6/7 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/lib/legalMoves.ts | 237 | runtime | 3/2 | 1 | — | 可按现有职责扩展 |
| shared-core/src/lib/matchFormat.ts | 59 | runtime | 3/1 | 2 | — | 可按现有职责扩展 |
| shared-core/src/lib/rules.ts | 432 | runtime | 17/1 | 5 | — | 可按现有职责扩展 |
| shared-core/src/lib/settlement.ts | 193 | runtime | 3/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/lib/tribute.ts | 399 | runtime | 3/4 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/lib/turn.ts | 152 | runtime | 2/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/protocol.ts | 170 | runtime | 2/4 | 4 | — | 可按现有职责扩展 |
| shared-core/src/types/game.ts | 157 | runtime | 28/0 | 7 | high-fan-in | 公共基础，兼容性优先 |
| work/guandan-cocos/assets/scripts/audio/ActionVoiceGate.ts | 15 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/audio/AudioProfiles.ts | 105 | runtime | 4/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/audio/CocosAudioController.ts | 236 | runtime | 2/7 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/audio/OptionalAudioAssetCache.ts | 88 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/audio/PlayVoiceProfiles.ts | 78 | runtime | 1/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/core/generated/ai/candidates.ts | 115 | runtime · generated | 3/6 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/checkpoint.ts | 56 | runtime · generated | 1/3 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/config.ts | 70 | runtime · generated | 1/1 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/decisionRunner.ts | 365 | runtime · generated | 1/11 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/decisionSupport.ts | 467 | runtime · generated | 4/6 | 3 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/engine.ts | 255 | runtime · generated | 2/14 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/fallbackDecision.ts | 184 | runtime · generated | 1/7 | 2 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/index.ts | 2 | runtime · generated | 2/2 | 6 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/policyOverrides.ts | 189 | runtime · generated | 2/11 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/random.ts | 49 | runtime · generated | 4/0 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/resourceProtection.ts | 126 | runtime · generated | 2/2 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/ruleMemo.ts | 118 | runtime · generated | 1/3 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/runtimeIntel.ts | 189 | runtime · generated | 6/2 | 3 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/scoring.ts | 199 | runtime · generated | 8/3 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/search.ts | 533 | runtime · generated | 3/4 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/simulation.ts | 39 | runtime · generated | 1/3 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/strategies/hard.ts | 197 | runtime · generated | 1/2 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/strategies/master.ts | 599 | runtime · generated | 1/4 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/strategies/medium.ts | 111 | runtime · generated | 1/2 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/strategies/profiles.ts | 61 | runtime · generated | 2/1 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/types.ts | 152 | type-only · generated | 18/3 | 0 | high-fan-in, no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/workerProtocol.ts | 93 | runtime · generated | 2/3 | 2 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/workerRuntime.ts | 62 | runtime · generated | 1/2 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/hints/handHintPolicy.ts | 105 | runtime · generated | 1/4 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/hints/model.ts | 37 | runtime · generated | 2/2 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/index.ts | 15 | runtime · generated | 59/15 | 6 | high-fan-in | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/deck.ts | 93 | runtime · generated | 3/1 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/engine.ts | 408 | runtime · generated | 6/7 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/legalMoves.ts | 237 | runtime · generated | 3/2 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/matchFormat.ts | 59 | runtime · generated | 6/1 | 2 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/rules.ts | 432 | runtime · generated | 17/1 | 5 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/settlement.ts | 193 | runtime · generated | 3/2 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/tribute.ts | 399 | runtime · generated | 3/4 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/turn.ts | 152 | runtime · generated | 2/2 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/protocol.ts | 170 | runtime · generated | 2/4 | 4 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/types/game.ts | 157 | runtime · generated | 28/0 | 7 | high-fan-in | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/development/FrontPagePreviewData.ts | 9 | runtime | 1/3 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/ArchivedPlayVisuals.ts | 100 | runtime | 2/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/BombEffectRenderer.ts | 526 | runtime | 1/6 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/CardBlastReaction.ts | 124 | runtime | 4/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/CardFlightController.ts | 114 | runtime | 3/5 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectActionPresentationCoordinator.ts | 103 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectAssetCatalog.ts | 226 | runtime | 2/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectController.ts | 342 | runtime | 2/23 | 3 | high-fan-out | 限制新增职责，优先拆分 |
| work/guandan-cocos/assets/scripts/effects/EffectDesignSystem.ts | 261 | runtime | 4/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectHandle.ts | 139 | runtime | 9/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectNodePool.ts | 36 | runtime | 2/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectPlaybackCoordinator.ts | 220 | runtime | 1/6 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectPolicy.ts | 23 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectPrimitives.ts | 111 | runtime | 2/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectProfileResolver.ts | 34 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectRecipes.ts | 79 | runtime | 4/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectRenderContext.ts | 42 | type-only | 6/7 | 1 | — | 稳定契约，检查调用方 |
| work/guandan-cocos/assets/scripts/effects/EffectRenderer.ts | 11 | type-only | 3/2 | 1 | — | 稳定契约，检查调用方 |
| work/guandan-cocos/assets/scripts/effects/EffectRendererRegistry.ts | 126 | runtime | 1/4 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/EffectTypes.ts | 35 | runtime | 9/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/LegacyCoordinateAdapter.ts | 93 | runtime | 2/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/effects/NetworkEffectSyncPolicy.ts | 70 | runtime | 6/0 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/SixBombRenderer.ts | 293 | runtime | 1/6 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/TransientEffectNodePool.ts | 123 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/effects/VfxCardSnapshot.ts | 178 | runtime | 3/5 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/GameManager.ts | 222 | runtime | 7/7 | 8 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/GameManagerProjection.ts | 145 | runtime | 2/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandArrangement.ts | 43 | runtime | 5/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandArrangementModel.ts | 228 | runtime | 3/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandDisplayOrdering.ts | 190 | runtime | 2/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandDragSelectionPolicy.ts | 103 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandGrouping.ts | 617 | runtime | 3/4 | 3 | large-file | 限制新增职责，优先拆分 |
| work/guandan-cocos/assets/scripts/game/HandGroupingHistory.ts | 44 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandGroupingState.ts | 263 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandGroupSuggestions.ts | 331 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandHintProtectionProjector.ts | 76 | runtime | 1/4 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/game/HandInteractionPolicy.ts | 11 | runtime | 3/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandInteractionState.ts | 89 | runtime | 4/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandRenderProjector.ts | 76 | runtime | 2/7 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandStackLayout.ts | 120 | runtime | 4/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandWorkspace.ts | 265 | runtime | 4/3 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/LocalHandSelectionController.ts | 158 | runtime | 1/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/NetworkActionController.ts | 78 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/NetworkMatchSnapshotController.ts | 182 | runtime | 1/4 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/PublicStraightFlushPossibility.ts | 36 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/RoundRecord.ts | 23 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/TeammateHandProjector.ts | 54 | runtime | 2/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/CocosSocketClient.ts | 194 | runtime | 1/2 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/FriendRoomViewReceiver.ts | 27 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyCleanupTracker.ts | 34 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyCommandSender.ts | 50 | runtime | 1/3 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyConnectionEventCoordinator.ts | 70 | runtime | 1/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyController.ts | 495 | runtime | 12/15 | 9 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyEntryAttempt.ts | 111 | runtime | 5/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyEntryRequest.ts | 30 | runtime | 1/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyMatchedEntryCoordinator.ts | 195 | runtime | 2/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyMessageRouter.ts | 210 | runtime | 1/6 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyModels.ts | 295 | runtime | 16/3 | 8 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyResumeConnectionWatchdog.ts | 49 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyResumeSession.ts | 81 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbySocketClient.ts | 18 | type-only | 5/0 | 2 | — | 稳定契约，检查调用方 |
| work/guandan-cocos/assets/scripts/network/LobbySyncTracker.ts | 100 | runtime | 1/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/replay/ReplayTimeline.ts | 353 | runtime | 3/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/CoastalPreviewPages.ts | 68 | runtime | 1/4 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomFormUi.ts | 35 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomPlatformFlow.ts | 151 | runtime | 2/3 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomPlatformPresenter.ts | 54 | runtime | 1/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomReservationCleanup.ts | 64 | runtime | 1/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomSettingsPolicy.ts | 207 | runtime | 2/2 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomSettingsPresenter.ts | 270 | runtime | 1/8 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomWaitingPresenter.ts | 151 | runtime | 1/5 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FrontPagePlayerState.ts | 31 | runtime | 4/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FrontPageWalletState.ts | 18 | runtime | 4/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/LobbyPageCatalog.ts | 33 | runtime | 2/1 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/LobbyPageDomain.ts | 518 | runtime | 1/18 | 8 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/LobbyPlayerProfilePresenter.ts | 60 | runtime | 1/8 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/MatchmakingPageDomain.ts | 381 | runtime | 1/5 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/MatchmakingPageView.ts | 55 | runtime | 1/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/PlayerCenterPageDomain.ts | 150 | runtime | 1/6 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/ProfileEditorModal.ts | 137 | runtime | 1/7 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/ReplayPageDomain.ts | 218 | runtime | 1/6 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/ShopPageDomain.ts | 45 | runtime | 1/4 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/FrontPageController.ts | 203 | runtime | 2/15 | 11 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/GameScene.ts | 576 | runtime | 0/33 | 22 | high-fan-out | 限制新增职责，优先拆分 |
| work/guandan-cocos/assets/scripts/scenes/MatchEndedPresentation.ts | 28 | runtime | 2/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/PageRouter.ts | 69 | runtime | 7/1 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/PlatformMatchRecoveryCoordinator.ts | 103 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/SceneBackdropController.ts | 169 | runtime | 2/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/SettlementPresentation.ts | 32 | runtime | 1/5 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/StartupCoordinator.ts | 147 | runtime | 1/5 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableHandInteractionController.ts | 317 | runtime | 3/7 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableHudPresenter.ts | 245 | runtime | 2/12 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableLayoutAuditBridge.ts | 213 | runtime | 1/4 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableMatchCoordinator.ts | 409 | runtime | 1/14 | 13 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableMatchPorts.ts | 36 | type-only | 1/14 | 0 | no-direct-test-mention | 稳定契约，检查调用方 |
| work/guandan-cocos/assets/scripts/scenes/TableNetworkEventBridge.ts | 96 | runtime | 1/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableOverlayController.ts | 468 | runtime | 2/5 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableProgressPresentation.ts | 50 | runtime | 1/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableSceneLayout.ts | 59 | runtime | 1/5 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableSceneNodes.ts | 84 | runtime | 2/4 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableSnapshotPresenter.ts | 41 | runtime | 2/1 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableTurnClockController.ts | 173 | runtime | 3/4 | 8 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/DataSnapshot.ts | 17 | runtime | 5/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/DevelopmentApis.ts | 126 | runtime | 2/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/DevelopmentPlayerStore.ts | 15 | runtime | 1/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/FrontPageGatewayContracts.ts | 362 | runtime | 30/1 | 4 | high-fan-in | 公共基础，兼容性优先 |
| work/guandan-cocos/assets/scripts/services/FrontPagePreviewData.ts | 8 | type-only | 2/2 | 1 | — | 稳定契约，检查调用方 |
| work/guandan-cocos/assets/scripts/services/GameAssetLoader.ts | 200 | runtime | 10/0 | 10 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/MatchmakingErrorPresentation.ts | 19 | runtime | 1/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/MatchWaitingPresentation.ts | 22 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/NetworkEndpoint.ts | 46 | runtime | 5/0 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/client.ts | 165 | runtime | 8/3 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/commerceGateways.ts | 16 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/competitionDecoders.ts | 87 | runtime | 3/5 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/competitionGateways.ts | 33 | runtime | 1/5 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/contracts.ts | 68 | runtime | 9/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/factory.ts | 29 | runtime | 1/9 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/friendRoomGateway.ts | 183 | runtime | 2/8 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/MatchRecoveryAttempt.ts | 31 | runtime | 1/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/matchRecoveryGateway.ts | 66 | runtime | 1/8 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/profileGateways.ts | 119 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/replayGateways.ts | 69 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/validation.ts | 117 | runtime | 8/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/PlatformApi.ts | 21 | runtime | 2/3 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/ProfileSaveCoordinator.ts | 38 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/RuntimeClientConfig.ts | 94 | runtime | 1/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatFriendInvite.ts | 69 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatLoginProvider.ts | 54 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatNetworkPolicy.ts | 31 | runtime | 3/1 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatProfileProvider.ts | 47 | runtime | 1/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/session/GameSession.ts | 95 | runtime | 8/2 | 12 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/session/GameSessionModel.ts | 140 | runtime | 1/1 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/CardPresentationMapper.ts | 23 | runtime | 3/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/CardSkinResolver.ts | 109 | runtime | 5/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/CardView.ts | 536 | runtime | 3/5 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ChatController.ts | 63 | runtime | 2/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ClassicCardFrameStore.ts | 71 | runtime | 4/2 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ClassicCardGeometry.ts | 27 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/CoastalUi.ts | 75 | runtime | 3/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/HandController.ts | 277 | runtime | 3/7 | 10 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/HandGroupBadgeView.ts | 49 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/LobbyAmbientMotion.ts | 94 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/LobbyLayoutPolicy.ts | 28 | runtime | 3/0 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/LobbyMenuView.ts | 93 | runtime | 2/3 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/LobbyMotionPolicy.ts | 13 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/PlayAreaController.ts | 255 | runtime | 4/8 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/PlayedCardLayout.ts | 24 | runtime | 3/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/PlayerSeatController.ts | 167 | runtime | 4/2 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ProfileAvatar.ts | 62 | runtime | 3/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/QuickChatPolicy.ts | 161 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ReplayBoardView.ts | 178 | runtime | 1/5 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ReplayViewpoint.ts | 43 | runtime | 2/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/RuntimeUiFactory.ts | 378 | runtime | 24/1 | 11 | high-fan-in | 公共基础，兼容性优先 |
| work/guandan-cocos/assets/scripts/ui/SafeAreaLayout.ts | 176 | runtime | 1/0 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ScreenAdapter.ts | 59 | runtime | 16/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/StartupLoadingOverlay.ts | 282 | runtime | 1/2 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableGameHud.ts | 567 | runtime | 2/7 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableGameHudFoundation.ts | 231 | runtime | 6/4 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHandViewStatus.ts | 29 | runtime | 1/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/ui/TableHudDynamicRenderer.ts | 141 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHudLayoutPolicy.ts | 249 | runtime | 7/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHudSeatViewGroup.ts | 220 | runtime | 2/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHudSuitAvailability.ts | 35 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHudTurnTimerView.ts | 100 | runtime | 1/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableLayerOrder.ts | 8 | runtime | 1/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/ui/TableLayoutOverlapAudit.ts | 198 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TablePlayActionPolicy.ts | 23 | runtime | 1/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TablePromptPolicy.ts | 31 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableSettlementView.ts | 54 | runtime | 2/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/WechatCapsuleLayout.ts | 33 | runtime | 4/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/bot-turn-pacing.js | 38 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/durable-file.js | 137 | runtime | 4/0 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/friend-room-members.js | 60 | runtime | 6/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/friend-room-observer-buffer.js | 48 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/friend-room-observer-runtime.js | 155 | runtime | 1/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/friend-room-settings.js | 239 | runtime | 9/0 | 5 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/game-session-projection.js | 79 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/game-session.js | 211 | runtime | 4/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/game-stats.js | 81 | runtime | 3/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/hk-bare-ip-profile.js | 58 | retained-entry | 0/1 | 1 | — | 保留兼容/工具边界 |
| work/guandan-windows-source/server/index.js | 3 | retained-entry | 0/0 | 3 | — | 保留兼容/工具边界 |
| work/guandan-windows-source/server/master-bot-policy.js | 72 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/match-format-policy.js | 36 | runtime | 2/3 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform-server.js | 41 | runtime | 0/7 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/account-service.js | 225 | runtime | 2/3 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/canonical-json.js | 17 | runtime | 8/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/classic-stakes.js | 46 | runtime | 5/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/commerce-service.js | 124 | runtime | 2/3 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/config.js | 177 | runtime | 3/0 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/crypto.js | 237 | runtime | 5/2 | 12 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/errors.js | 16 | runtime | 15/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/friend-room-roster.js | 21 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/friend-room-service.js | 442 | runtime | 4/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/game-result-outbox-store.js | 98 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/game-result-service.js | 287 | runtime | 1/9 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/http.js | 266 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/match-bot-fill.js | 104 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/matchmaking-service.js | 341 | runtime | 1/8 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/merchant-service.js | 201 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/profile-avatar.js | 54 | runtime | 1/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/rating-matchmaking.js | 38 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/rating.js | 122 | runtime | 4/0 | 5 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/report-delivery-lifetime.js | 71 | runtime | 1/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/report-event-contract.js | 17 | runtime | 2/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/result-reporter.js | 185 | runtime | 1/3 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/seeds.js | 43 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/service.js | 440 | runtime | 1/11 | 10 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/spectator-domain.js | 274 | runtime | 3/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/spectator-event-reporter.js | 165 | runtime | 1/4 | 5 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/spectator-event-service.js | 362 | runtime | 1/8 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/spectator-outbox-store.js | 95 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/state-collections.js | 12 | runtime | 2/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/state-migrations.js | 257 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/storage.js | 168 | runtime | 3/2 | 10 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/tournament-orchestrator.js | 305 | runtime | 4/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/tournament-pairing.js | 68 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/tournament-service.js | 244 | runtime | 4/4 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/wx-auth.js | 38 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/player-nicknames.js | 30 | runtime | 3/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/room-state-store.js | 79 | runtime | 2/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-accepted-action-store.js | 43 | runtime | 1/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-command-gateway.js | 123 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-command-publication.js | 17 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-command-router.js | 20 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-entry-command-handler.js | 305 | runtime | 1/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-game-command-handler.js | 231 | runtime | 1/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-game-start-coordinator.js | 306 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-lobby-command-handler.js | 156 | runtime | 1/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/weapp-match-bot-seats.js | 31 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-match-lifecycle.js | 488 | runtime | 1/7 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-operation-scheduler.js | 49 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-exit.js | 98 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-expiry-jobs.js | 31 | runtime | 2/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/weapp-room-expiry.js | 49 | runtime | 1/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-metadata.js | 132 | runtime | 1/4 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-publisher.js | 189 | runtime | 1/3 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-runtime-persistence.js | 44 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-runtime-recovery.js | 115 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-turn-clock.js | 67 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-websocket-transport.js | 140 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-ws.js | 817 | runtime | 0/31 | 15 | large-file, high-fan-out | 限制新增职责，优先拆分 |
