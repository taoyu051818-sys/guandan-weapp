import React from 'react';
import { motion } from 'framer-motion';
import { Card } from '../../types/game';

interface PlayingCardProps {
  card: Card;
  isSelected?: boolean;
  onClick?: () => void;
  className?: string;
  isFaceDown?: boolean;
}

const suitSymbols: Record<string, string> = {
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
  joker: '★',
};

const suitColors: Record<string, string> = {
  spade: 'text-luxury-slate',
  heart: 'text-luxury-crimson',
  club: 'text-luxury-slate',
  diamond: 'text-luxury-crimson',
  joker: 'text-luxury-goldDark',
};

export const PlayingCard: React.FC<PlayingCardProps> = ({
  card,
  isSelected = false,
  onClick,
  className = '',
  isFaceDown = false,
}) => {
  if (isFaceDown) {
    return (
      <motion.div
        className={`relative w-[5.5rem] h-[8rem] rounded-xl shadow-card border border-luxury-gold/40 bg-gradient-to-br from-luxury-midnight to-luxury-obsidian flex items-center justify-center cursor-pointer overflow-hidden ${className}`}
        whileHover={{ y: -5, scale: 1.02 }}
        onClick={onClick}
      >
        <div className="absolute inset-1.5 border border-luxury-gold/20 rounded-lg" />
        <div className="absolute inset-3 border border-luxury-gold/10 rounded-md" />
        <div className="w-full h-full opacity-[0.15] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAiPjwvcmVjdD4KPHBhdGggZD0iTTAgMEw4IDhaTTggMEwwIDhaIiBzdHJva2U9IiNkNGFmMzciIHN0cm9rZS13aWR0aD0iMC41IiBzdHJva2Utb3BhY2l0eT0iMC41Ij48L3BhdGg+Cjwvc3ZnPg==')] bg-repeat" />
        <div className="relative z-10 flex flex-col items-center">
          <span className="text-luxury-gold/60 text-xs font-cinzel font-bold tracking-widest uppercase rotate-90">GuanDan</span>
        </div>
      </motion.div>
    );
  }

  const isRedJoker = card.suit === 'joker' && card.rank === 'Big';
  const displayRank = card.suit === 'joker' ? (isRedJoker ? '大王' : '小王') : card.rank;
  const textColor = card.suit === 'joker' ? (isRedJoker ? 'text-luxury-crimson' : 'text-luxury-slate') : suitColors[card.suit];

  return (
    <motion.div
      className={`relative w-[5.5rem] h-[8rem] rounded-xl shadow-card bg-[#faf9f6] border border-slate-300 flex flex-col justify-between p-1.5 cursor-pointer select-none transition-shadow hover:shadow-card-hover ${
        isSelected ? 'ring-2 ring-luxury-gold ring-offset-2 ring-offset-luxury-midnight' : ''
      } ${className}`}
      initial={{ y: 0 }}
      animate={{ y: isSelected ? -20 : 0 }}
      whileHover={{ y: isSelected ? -20 : -10 }}
      onClick={onClick}
    >
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/60 to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-noise opacity-[0.03] pointer-events-none rounded-xl" />
      
      <div className={`text-sm font-bold leading-none ${textColor} flex flex-col items-center self-start relative z-10`}>
        <span className="font-cinzel text-lg tracking-tighter">{displayRank}</span>
        <span className="text-xl mt-0.5">{suitSymbols[card.suit]}</span>
      </div>
      
      <div className={`absolute inset-0 flex items-center justify-center opacity-[0.08] text-7xl pointer-events-none ${textColor}`}>
        {suitSymbols[card.suit]}
      </div>
      
      {card.isLevelCard && !card.isRedJoker && card.suit !== 'joker' && (
        <div className="absolute top-[52px] left-[5px] text-[9px] font-black bg-gradient-to-r from-luxury-gold to-luxury-goldDark text-luxury-obsidian px-[3px] py-0.5 rounded shadow-sm z-20 uppercase tracking-widest border border-luxury-goldLight/50">
          主
        </div>
      )}

      {card.isRedJoker && card.suit !== 'joker' && (
        <div className="absolute top-[52px] left-[5px] text-[9px] font-black bg-gradient-to-r from-luxury-crimson to-red-800 text-white px-[3px] py-0.5 rounded shadow-sm z-20 uppercase tracking-widest border border-red-400/30">
          配
        </div>
      )}

      <div className={`text-sm font-bold leading-none ${textColor} flex flex-col items-center self-end rotate-180 relative z-10`}>
        <span className="font-cinzel text-lg tracking-tighter">{displayRank}</span>
        <span className="text-xl mt-0.5">{suitSymbols[card.suit]}</span>
      </div>
    </motion.div>
  );
};
