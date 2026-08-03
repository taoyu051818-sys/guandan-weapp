import { useMemo, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { createDeck, dealCards, shuffleDeck } from '../../core/deck'
import type { Card, Rank } from '../../core/game'
import { getPlayInfo } from '../../core/rules'
import './index.scss'

const suitLabel: Record<string, string> = { spade: '♠', heart: '♥', club: '♣', diamond: '♦', joker: '王' }
const rankLabel = (card: Card) => card.suit === 'joker' ? (card.rank === 'Big' ? '大王' : '小王') : String(card.rank)
const sortCards = (cards: Card[]) => [...cards].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id))

export default function IndexPage() {
  const [level, setLevel] = useState<Rank>(2)
  const [hand, setHand] = useState<Card[]>(() => sortCards(dealCards(shuffleDeck(createDeck(2))).p1))
  const [selected, setSelected] = useState<string[]>([])
  const selectedCards = useMemo(() => hand.filter(card => selected.includes(card.id)), [hand, selected])
  const play = getPlayInfo(selectedCards)
  const deal = () => {
    setHand(sortCards(dealCards(shuffleDeck(createDeck(level))).p1))
    setSelected([])
  }
  const toggleCard = (id: string) => setSelected(old => old.includes(id) ? old.filter(item => item !== id) : [...old, id])
  return <View className='table'>
    <View className='header'><Text className='title'>掼蛋大师</Text><Text className='level'>当前级牌：{level}</Text></View>
    <View className='opponents'><Text>对家 27 张</Text><Text>上家 27 张</Text><Text>下家 27 张</Text></View>
    <View className='play-area'><Text>{selected.length === 0 ? '请选择手牌' : play ? `已选：${play.type}` : '当前组合不符合牌型'}</Text></View>
    <View className='hand'>{hand.map(card => <View key={card.id} onClick={() => toggleCard(card.id)} className={`card ${selected.includes(card.id) ? 'selected' : ''} ${card.suit === 'heart' || card.suit === 'diamond' ? 'red' : ''}`}><Text>{rankLabel(card)}</Text><Text>{suitLabel[card.suit]}</Text></View>)}</View>
    <View className='actions'><Button type='primary' onClick={deal}>重新发牌</Button><Button disabled={!play}>出牌</Button></View>
  </View>
}
