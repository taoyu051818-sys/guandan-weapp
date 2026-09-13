# 逐文件代码健康清单

生成日期：2026-09-13。语法级清单包含生成副本；不代表人工审查或真机测试覆盖率。

由 `node scripts/audit-code-health.mjs` 只读生成。

范围：Cocos 运行源码、共享规则源码、权威服务端 JS；不含构建产物、第三方素材和归档工程。

runtime=语法级保守入口可达（不等同于打包器最终保留）；type-only=仅类型可达；retained-entry=明确保留的兼容/工具入口；review=需人工核对，不能据此直接删除。

测试提及数是静态文本关联，**不是测试覆盖率**。large-file >600 行；高入度/出度 ≥18。生成规则只改 shared-core，不能直接改 generated。

| 范围 | 文件 | 行数 | 运行入口可达 | 待核对 |
| --- | ---: | ---: | ---: | ---: |
| client | 241 | 28549 | 234 | 0 |
| core | 40 | 4159 | 37 | 0 |
| server | 87 | 11172 | 85 | 0 |

| 文件 | 行数 | 状态 | 入/出依赖 | 测试提及 | 维护提醒 | 开发建议 |
| --- | ---: | --- | --- | ---: | --- | --- |
| shared-core/src/ai/candidates.ts | 91 | runtime | 2/5 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/checkpoint.ts | 22 | runtime | 1/4 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/decisionRunner.ts | 59 | runtime | 1/8 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/engine.ts | 69 | runtime | 2/9 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/index.ts | 2 | runtime | 3/2 | 13 | — | 可按现有职责扩展 |
| shared-core/src/ai/random.ts | 49 | runtime | 7/0 | 6 | — | 可按现有职责扩展 |
| shared-core/src/ai/resourceProtection.ts | 38 | runtime | 1/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/ruleMemo.ts | 119 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/scoring.ts | 4 | runtime | 4/1 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/simulation.ts | 42 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/team/belief.ts | 114 | runtime | 2/6 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/team/handRoute.ts | 123 | runtime | 1/4 | 2 | — | 可按现有职责扩展 |
| shared-core/src/ai/team/handStrength.ts | 48 | runtime | 2/2 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/team/holdingShapes.ts | 100 | runtime | 1/4 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/team/journal.ts | 61 | runtime | 2/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/ai/team/parameters.ts | 23 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/team/policy.ts | 151 | runtime | 2/11 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/team/tableOutlook.ts | 33 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| shared-core/src/ai/team/types.ts | 58 | type-only | 10/3 | 1 | — | 稳定契约，检查调用方 |
| shared-core/src/ai/types.ts | 92 | type-only | 7/4 | 1 | — | 稳定契约，检查调用方 |
| shared-core/src/ai/workerProtocol.ts | 87 | runtime | 2/3 | 2 | — | 可按现有职责扩展 |
| shared-core/src/ai/workerRuntime.ts | 62 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| shared-core/src/hints/handHintPolicy.ts | 98 | runtime | 1/7 | 1 | — | 可按现有职责扩展 |
| shared-core/src/hints/model.ts | 41 | runtime | 2/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/index.ts | 18 | runtime | 0/18 | 13 | high-fan-out | 限制新增职责，优先拆分 |
| shared-core/src/lib/ai.ts | 1 | retained-entry | 0/1 | 6 | — | 保留兼容/工具边界 |
| shared-core/src/lib/classicModes.ts | 31 | runtime | 1/1 | 4 | — | 可按现有职责扩展 |
| shared-core/src/lib/dealing.ts | 22 | runtime | 2/4 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/lib/deck.ts | 93 | runtime | 5/1 | 2 | — | 可按现有职责扩展 |
| shared-core/src/lib/engine.ts | 416 | runtime | 7/7 | 1 | — | 可按现有职责扩展 |
| shared-core/src/lib/legalMoves.ts | 255 | runtime | 3/2 | 3 | — | 可按现有职责扩展 |
| shared-core/src/lib/matchFormat.ts | 78 | runtime | 7/1 | 3 | — | 可按现有职责扩展 |
| shared-core/src/lib/noShuffleDeal.ts | 70 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| shared-core/src/lib/rules.ts | 435 | runtime | 17/1 | 6 | — | 可按现有职责扩展 |
| shared-core/src/lib/settlement.ts | 218 | runtime | 3/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/lib/tribute.ts | 403 | runtime | 3/5 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/lib/turn.ts | 152 | runtime | 2/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/lib/variantRules.ts | 56 | runtime | 3/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| shared-core/src/protocol.ts | 170 | runtime | 2/4 | 6 | — | 可按现有职责扩展 |
| shared-core/src/types/game.ts | 155 | runtime | 31/0 | 8 | high-fan-in | 公共基础，兼容性优先 |
| work/guandan-cocos/assets/scripts/audio/ActionVoiceGate.ts | 15 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/audio/AudioProfiles.ts | 105 | runtime | 4/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/audio/CocosAudioController.ts | 235 | runtime | 2/8 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/audio/OptionalAudioAssetCache.ts | 88 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/audio/PlayVoiceProfiles.ts | 86 | runtime | 1/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/audio/TransientAudioChannels.ts | 39 | runtime | 1/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/core/generated/ai/candidates.ts | 91 | runtime · generated | 2/5 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/checkpoint.ts | 22 | runtime · generated | 1/4 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/decisionRunner.ts | 59 | runtime · generated | 1/8 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/engine.ts | 69 | runtime · generated | 2/9 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/index.ts | 2 | runtime · generated | 2/2 | 13 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/random.ts | 49 | runtime · generated | 7/0 | 6 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/resourceProtection.ts | 38 | runtime · generated | 1/1 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/ruleMemo.ts | 119 | runtime · generated | 1/3 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/scoring.ts | 4 | runtime · generated | 4/1 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/simulation.ts | 42 | runtime · generated | 1/3 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/team/belief.ts | 114 | runtime · generated | 2/6 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/team/handRoute.ts | 123 | runtime · generated | 1/4 | 2 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/team/handStrength.ts | 48 | runtime · generated | 2/2 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/team/holdingShapes.ts | 100 | runtime · generated | 1/4 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/team/journal.ts | 61 | runtime · generated | 2/2 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/team/parameters.ts | 23 | runtime · generated | 1/0 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/team/policy.ts | 151 | runtime · generated | 2/11 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/team/tableOutlook.ts | 33 | runtime · generated | 1/2 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/team/types.ts | 58 | type-only · generated | 10/3 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/types.ts | 92 | type-only · generated | 7/4 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/workerProtocol.ts | 87 | runtime · generated | 2/3 | 2 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/ai/workerRuntime.ts | 62 | runtime · generated | 1/2 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/hints/handHintPolicy.ts | 98 | runtime · generated | 1/7 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/hints/model.ts | 41 | runtime · generated | 2/3 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/index.ts | 18 | runtime · generated | 64/18 | 13 | high-fan-in, high-fan-out | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/classicModes.ts | 31 | runtime · generated | 5/1 | 4 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/dealing.ts | 22 | runtime · generated | 2/4 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/deck.ts | 93 | runtime · generated | 5/1 | 2 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/engine.ts | 416 | runtime · generated | 7/7 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/legalMoves.ts | 255 | runtime · generated | 3/2 | 3 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/matchFormat.ts | 78 | runtime · generated | 10/1 | 3 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/noShuffleDeal.ts | 70 | runtime · generated | 1/2 | 1 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/rules.ts | 435 | runtime · generated | 17/1 | 6 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/settlement.ts | 218 | runtime · generated | 3/3 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/tribute.ts | 403 | runtime · generated | 3/5 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/turn.ts | 152 | runtime · generated | 2/2 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/lib/variantRules.ts | 56 | runtime · generated | 4/3 | 0 | no-direct-test-mention | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/protocol.ts | 170 | runtime · generated | 2/4 | 6 | — | 只读，改共享源 |
| work/guandan-cocos/assets/scripts/core/generated/types/game.ts | 155 | runtime · generated | 31/0 | 8 | high-fan-in | 只读，改共享源 |
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
| work/guandan-cocos/assets/scripts/game/GameManager.ts | 229 | runtime | 9/8 | 10 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/GameManagerProjection.ts | 147 | runtime | 2/3 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandArrangement.ts | 43 | runtime | 5/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandArrangementModel.ts | 239 | runtime | 3/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandDisplayOrdering.ts | 188 | runtime | 2/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandDragSelectionPolicy.ts | 103 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandGestureEpoch.ts | 18 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandGrouping.ts | 590 | runtime | 4/3 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandGroupingState.ts | 264 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandGroupPresentationCache.ts | 45 | runtime | 2/4 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/game/HandGroupSuggestions.ts | 322 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandHintProtectionProjector.ts | 74 | runtime | 1/4 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/game/HandInteractionPolicy.ts | 53 | runtime | 3/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandInteractionState.ts | 38 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandRenderProjector.ts | 50 | runtime | 2/7 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandStackLayout.ts | 120 | runtime | 5/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/HandWorkspace.ts | 204 | runtime | 5/4 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/LocalHandSelectionController.ts | 167 | runtime | 1/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/NetworkActionController.ts | 78 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/NetworkMatchSnapshotController.ts | 195 | runtime | 1/4 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/PublicStraightFlushPossibility.ts | 36 | runtime | 1/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/RoundRecord.ts | 24 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/RoundViewState.ts | 27 | runtime | 2/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/game/TeammateHandProjector.ts | 54 | runtime | 2/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/CocosSocketClient.ts | 194 | runtime | 1/2 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/DuplicateRoomModel.ts | 37 | runtime | 5/0 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/FriendRoomViewReceiver.ts | 28 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyCleanupTracker.ts | 34 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyCommandSender.ts | 51 | runtime | 1/3 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyConnectionEventCoordinator.ts | 70 | runtime | 1/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyController.ts | 495 | runtime | 16/15 | 12 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyEntryAttempt.ts | 111 | runtime | 5/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyEntryRequest.ts | 30 | runtime | 1/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyMatchedEntryCoordinator.ts | 195 | runtime | 2/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyMessageRouter.ts | 207 | runtime | 1/6 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyModels.ts | 305 | runtime | 16/4 | 9 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyResumeConnectionWatchdog.ts | 49 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbyResumeSession.ts | 81 | runtime | 1/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/network/LobbySocketClient.ts | 18 | type-only | 5/0 | 2 | — | 稳定契约，检查调用方 |
| work/guandan-cocos/assets/scripts/network/LobbySyncTracker.ts | 100 | runtime | 1/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/replay/ReplayTimeline.ts | 353 | runtime | 3/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/DuplicateTablePresentation.ts | 15 | runtime | 2/1 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/DuplicateTableStatusView.ts | 23 | runtime | 1/4 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/CoastalPreviewPages.ts | 68 | runtime | 1/4 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/DuplicateRoomWaitingView.ts | 76 | runtime | 2/6 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRankingModal.ts | 95 | runtime | 1/5 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomFormUi.ts | 42 | runtime | 3/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomModeTabs.ts | 21 | runtime | 1/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomNumberModal.ts | 53 | runtime | 1/3 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomPlatformFlow.ts | 155 | runtime | 1/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomReservationCleanup.ts | 64 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomRuleContent.ts | 44 | runtime | 2/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomRulesModal.ts | 74 | runtime | 2/4 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomSettingsPolicy.ts | 223 | runtime | 3/2 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomSettingsPresenter.ts | 263 | runtime | 1/11 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FriendRoomWaitingPresenter.ts | 166 | runtime | 1/6 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FrontPagePlayerState.ts | 31 | runtime | 4/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/FrontPageWalletState.ts | 18 | runtime | 4/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/LobbyPageCatalog.ts | 27 | runtime | 2/1 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/LobbyPageDomain.ts | 503 | runtime | 1/18 | 10 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/LobbyPlayerProfilePresenter.ts | 61 | runtime | 1/8 | 9 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/MatchmakingPageDomain.ts | 384 | runtime | 1/6 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/MatchmakingPageView.ts | 55 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/PlayerCenterPageDomain.ts | 158 | runtime | 1/6 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/ProfileEditorModal.ts | 171 | runtime | 1/8 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/ReplayPageDomain.ts | 222 | runtime | 1/6 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/ShopPageDomain.ts | 45 | runtime | 1/4 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/TournamentCenterController.ts | 131 | runtime | 1/5 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/TournamentCenterModel.ts | 35 | runtime | 2/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/front-pages/TournamentCenterView.ts | 91 | runtime | 1/4 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/FrontPageController.ts | 260 | runtime | 2/20 | 11 | high-fan-out | 限制新增职责，优先拆分 |
| work/guandan-cocos/assets/scripts/scenes/GameScene.ts | 571 | runtime | 0/33 | 23 | high-fan-out | 限制新增职责，优先拆分 |
| work/guandan-cocos/assets/scripts/scenes/MatchEndedPresentation.ts | 39 | runtime | 2/4 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/PageRouter.ts | 70 | runtime | 8/1 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/PlatformMatchRecoveryCoordinator.ts | 105 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/SceneBackdropController.ts | 171 | runtime | 2/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/SettlementPresentation.ts | 37 | runtime | 1/6 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/StartupCoordinator.ts | 147 | runtime | 1/5 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableHandInteractionController.ts | 249 | runtime | 3/6 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableHudPresenter.ts | 245 | runtime | 2/15 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableLayoutAuditBridge.ts | 214 | runtime | 1/4 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableMatchCoordinator.ts | 322 | runtime | 1/11 | 14 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableMatchPorts.ts | 37 | type-only | 2/14 | 0 | no-direct-test-mention | 稳定契约，检查调用方 |
| work/guandan-cocos/assets/scripts/scenes/TableNetworkEventBridge.ts | 96 | runtime | 1/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableOverlayController.ts | 319 | runtime | 2/6 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TablePhasePresenter.ts | 110 | runtime | 1/8 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableProgressPresentation.ts | 50 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableSceneLayout.ts | 57 | runtime | 1/5 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableSceneNodes.ts | 82 | runtime | 2/5 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableSnapshotPresenter.ts | 47 | runtime | 2/1 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableTurnClockController.ts | 115 | runtime | 3/5 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/scenes/TableTurnClockProjection.ts | 32 | runtime | 1/4 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/DataSnapshot.ts | 17 | runtime | 7/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/DefaultProfileCatalog.ts | 123 | runtime | 2/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/DefaultProfileFrames.ts | 21 | runtime | 2/2 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/DevelopmentApis.ts | 127 | runtime | 2/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/DevelopmentPlayerStore.ts | 17 | runtime | 1/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/FrontPageGatewayContracts.ts | 367 | runtime | 34/2 | 4 | high-fan-in | 公共基础，兼容性优先 |
| work/guandan-cocos/assets/scripts/services/FrontPagePreviewData.ts | 8 | type-only | 2/2 | 1 | — | 稳定契约，检查调用方 |
| work/guandan-cocos/assets/scripts/services/GameAssetLoader.ts | 200 | runtime | 11/0 | 15 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/MatchmakingErrorPresentation.ts | 19 | runtime | 1/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/MatchWaitingPresentation.ts | 22 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/NetworkEndpoint.ts | 46 | runtime | 5/0 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/client.ts | 165 | runtime | 9/3 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/commerceGateways.ts | 16 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/competitionDecoders.ts | 87 | runtime | 3/5 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/competitionGateways.ts | 33 | runtime | 1/5 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/contracts.ts | 68 | runtime | 10/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/factory.ts | 31 | runtime | 1/10 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/platform/friendRoomGateway.ts | 194 | runtime | 2/8 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/MatchRecoveryAttempt.ts | 31 | runtime | 1/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/matchRecoveryGateway.ts | 67 | runtime | 1/8 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/profileGateways.ts | 122 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/replayGateways.ts | 69 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/TournamentApiGateway.ts | 85 | runtime | 1/5 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/tournamentDecoders.ts | 149 | runtime | 1/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/services/platform/validation.ts | 117 | runtime | 10/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/PlatformApi.ts | 21 | runtime | 2/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/ProfileImagePicker.ts | 53 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/ProfileSaveCoordinator.ts | 38 | runtime | 3/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/RuntimeClientConfig.ts | 94 | runtime | 1/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatFriendInvite.ts | 69 | runtime | 1/0 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatFriendRanking.ts | 75 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatLoginProvider.ts | 54 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatNetworkPolicy.ts | 31 | runtime | 3/1 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatProfileProvider.ts | 58 | runtime | 2/3 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatProfileResult.ts | 30 | runtime | 2/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/services/WechatProfileSync.ts | 64 | runtime | 1/4 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/session/GameSession.ts | 97 | runtime | 8/2 | 15 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/session/GameSessionModel.ts | 145 | runtime | 1/1 | 6 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/CardPresentationMapper.ts | 23 | runtime | 3/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/CardSkinResolver.ts | 109 | runtime | 5/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/CardView.ts | 503 | runtime | 3/5 | 8 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ClassicCardFrameStore.ts | 71 | runtime | 4/2 | 8 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ClassicCardGeometry.ts | 27 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/CoastalUi.ts | 75 | runtime | 4/1 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/HandController.ts | 279 | runtime | 3/6 | 10 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/HandGroupBadgeView.ts | 50 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/LobbyAmbientMotion.ts | 95 | runtime | 1/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/LobbyLayoutPolicy.ts | 28 | runtime | 3/0 | 8 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/LobbyMenuView.ts | 93 | runtime | 2/3 | 8 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/LobbyMotionPolicy.ts | 15 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/PlayAreaController.ts | 264 | runtime | 4/8 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/PlayedCardLayout.ts | 27 | runtime | 3/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/PlayerSeatController.ts | 129 | runtime | 4/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ProfileAvatar.ts | 64 | runtime | 3/3 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ReplayBoardView.ts | 179 | runtime | 1/6 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ReplayViewpoint.ts | 43 | runtime | 2/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/RuntimeUiFactory.ts | 347 | runtime | 30/2 | 17 | high-fan-in | 公共基础，兼容性优先 |
| work/guandan-cocos/assets/scripts/ui/SafeAreaLayout.ts | 176 | runtime | 1/0 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/ScreenAdapter.ts | 59 | runtime | 22/1 | 1 | high-fan-in | 公共基础，兼容性优先 |
| work/guandan-cocos/assets/scripts/ui/StartupLoadingOverlay.ts | 283 | runtime | 1/3 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableButtonMetrics.ts | 6 | runtime | 7/0 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableGameHud.ts | 567 | runtime | 3/10 | 8 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableGameHudFoundation.ts | 235 | runtime | 8/7 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHandViewStatus.ts | 29 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHudDynamicRenderer.ts | 143 | runtime | 1/4 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHudLayoutPolicy.ts | 251 | runtime | 8/2 | 5 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHudSeatViewGroup.ts | 222 | runtime | 2/4 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHudSuitAvailability.ts | 35 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableHudTurnTimerView.ts | 100 | runtime | 1/1 | 4 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableLayerOrder.ts | 8 | runtime | 1/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/ui/TableLayoutOverlapAudit.ts | 198 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TablePlayActionPolicy.ts | 23 | runtime | 1/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TablePromptPolicy.ts | 31 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableSettlementView.ts | 54 | runtime | 2/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/TableToolbarLayout.ts | 19 | runtime | 1/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-cocos/assets/scripts/ui/TableTributeInfoView.ts | 38 | runtime | 2/3 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/UiFrameStyle.ts | 36 | runtime | 11/0 | 7 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/WechatCapsuleLayout.ts | 33 | runtime | 4/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-cocos/assets/scripts/ui/WechatFriendCanvas.ts | 53 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/bot-turn-pacing.js | 34 | runtime | 3/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/default-profiles.js | 19 | runtime | 3/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/duplicate-auto-policy.js | 18 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/duplicate-room-actions.js | 90 | runtime | 1/2 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/duplicate-room-admission.js | 51 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/duplicate-room-model.js | 61 | runtime | 4/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/duplicate-room-projection.js | 72 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/duplicate-room-runtime.js | 181 | runtime | 1/6 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/durable-file.js | 137 | runtime | 4/0 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/friend-room-bots.js | 15 | runtime | 3/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/friend-room-members.js | 60 | runtime | 6/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/friend-room-observer-buffer.js | 49 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/friend-room-observer-runtime.js | 160 | runtime | 1/3 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/friend-room-settings.js | 241 | runtime | 10/0 | 9 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/game-session-projection.js | 79 | runtime | 2/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/game-session.js | 211 | runtime | 5/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/game-stats.js | 81 | runtime | 3/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/hk-bare-ip-profile.js | 58 | retained-entry | 0/1 | 1 | — | 保留兼容/工具边界 |
| work/guandan-windows-source/server/index.js | 3 | retained-entry | 0/0 | 6 | — | 保留兼容/工具边界 |
| work/guandan-windows-source/server/master-bot-policy.js | 82 | runtime | 3/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/match-format-policy.js | 34 | runtime | 2/2 | 6 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform-server.js | 41 | runtime | 0/7 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/account-service.js | 239 | runtime | 2/5 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/canonical-json.js | 17 | runtime | 8/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/classic-stakes.js | 44 | runtime | 4/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/commerce-service.js | 124 | runtime | 2/3 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/config.js | 175 | runtime | 3/0 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/crypto.js | 238 | runtime | 5/2 | 18 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/duplicate-room-roster.js | 24 | runtime | 1/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/errors.js | 16 | runtime | 20/0 | 2 | high-fan-in | 公共基础，兼容性优先 |
| work/guandan-windows-source/server/platform/friend-room-number-limiter.js | 20 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/friend-room-personal-scores.js | 16 | runtime | 1/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/friend-room-roster.js | 32 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/friend-room-service.js | 455 | runtime | 4/5 | 5 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/game-result-outbox-store.js | 98 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/game-result-service.js | 302 | runtime | 1/11 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/http.js | 279 | runtime | 1/4 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/match-bot-fill.js | 105 | runtime | 1/3 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/match-participants.js | 19 | runtime | 2/1 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/matchmaking-service.js | 341 | runtime | 1/8 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/merchant-service.js | 201 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/profile-avatar.js | 59 | runtime | 1/3 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/profile-upload.js | 37 | runtime | 3/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/rating-matchmaking.js | 38 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/rating.js | 122 | runtime | 4/0 | 5 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/report-delivery-lifetime.js | 71 | runtime | 1/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/report-event-contract.js | 17 | runtime | 2/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/result-reporter.js | 185 | runtime | 1/3 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/seeds.js | 43 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/service.js | 452 | runtime | 1/11 | 14 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/spectator-domain.js | 282 | runtime | 3/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/spectator-event-reporter.js | 165 | runtime | 1/4 | 6 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/spectator-event-service.js | 365 | runtime | 1/9 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/spectator-outbox-store.js | 95 | runtime | 1/2 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/state-collections.js | 12 | runtime | 2/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/platform/state-migrations.js | 257 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/storage.js | 168 | runtime | 3/2 | 14 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/tournament-orchestrator.js | 308 | runtime | 4/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/tournament-pairing.js | 68 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/tournament-service.js | 240 | runtime | 4/5 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/tournament-standings.js | 40 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/platform/wx-auth.js | 38 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/player-nicknames.js | 27 | runtime | 4/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/room-state-store.js | 79 | runtime | 3/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-accepted-action-store.js | 43 | runtime | 1/0 | 5 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-command-gateway.js | 124 | runtime | 1/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-command-publication.js | 17 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-command-router.js | 20 | runtime | 1/0 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-entry-command-handler.js | 306 | runtime | 1/1 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-game-command-handler.js | 159 | runtime | 1/1 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-game-start-coordinator.js | 310 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-lobby-command-handler.js | 159 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-match-bot-seats.js | 31 | runtime | 2/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-match-lifecycle.js | 479 | runtime | 1/8 | 5 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-operation-scheduler.js | 49 | runtime | 1/0 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-action-executor.js | 77 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-close-coordinator.js | 45 | runtime | 1/1 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-exit.js | 98 | runtime | 1/2 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-expiry-jobs.js | 31 | runtime | 3/0 | 0 | no-direct-test-mention | 扩展前核对间接测试 |
| work/guandan-windows-source/server/weapp-room-expiry.js | 53 | runtime | 1/1 | 4 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-metadata.js | 130 | runtime | 1/4 | 5 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-room-publisher.js | 190 | runtime | 1/4 | 5 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-runtime-persistence.js | 44 | runtime | 1/1 | 2 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-runtime-recovery.js | 115 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-turn-clock.js | 65 | runtime | 1/2 | 3 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-websocket-transport.js | 140 | runtime | 1/0 | 1 | — | 可按现有职责扩展 |
| work/guandan-windows-source/server/weapp-ws.js | 797 | runtime | 0/33 | 19 | large-file, high-fan-out | 限制新增职责，优先拆分 |
