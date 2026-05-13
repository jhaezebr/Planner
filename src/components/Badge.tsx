import React from 'react';

interface Props {
  children: React.ReactNode;
  variant?: 'OF' | 'DF' | 'RF' | 'VF' | 'GF' | 'WV' | 'RV' | 'gray' | 'green' | 'red' | 'orange' | 'yellow' | 'purple';
  size?: 'sm' | 'xs';
}

const variantClasses: Record<string, string> = {
  OF: 'bg-red-100 text-red-800 border border-red-300',
  DF: 'bg-orange-100 text-orange-800 border border-orange-300',
  RF: 'bg-yellow-100 text-yellow-800 border border-yellow-300',
  VF: 'bg-purple-100 text-purple-800 border border-purple-300',
  GF: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
  WV: 'bg-blue-100 text-blue-800 border border-blue-300',
  RV: 'bg-cyan-100 text-cyan-800 border border-cyan-300',
  CARRY_VAK: 'bg-indigo-100 text-indigo-800 border border-indigo-300',
  CARRY_RV: 'bg-teal-100 text-teal-800 border border-teal-300',
  gray: 'bg-gray-100 text-gray-600 border border-gray-300',
  green: 'bg-green-100 text-green-800 border border-green-300',
  red: 'bg-red-100 text-red-800 border border-red-300',
  orange: 'bg-orange-100 text-orange-700 border border-orange-300',
  yellow: 'bg-yellow-100 text-yellow-700 border border-yellow-300',
  purple: 'bg-purple-100 text-purple-800 border border-purple-300',
};

export function Badge({ children, variant = 'gray', size = 'sm' }: Props) {
  const sizeClass = size === 'xs' ? 'text-[10px] px-1 py-0' : 'text-xs px-1.5 py-0.5';
  return (
    <span className={`inline-flex items-center rounded font-medium ${sizeClass} ${variantClasses[variant] ?? variantClasses.gray}`}>
      {children}
    </span>
  );
}
