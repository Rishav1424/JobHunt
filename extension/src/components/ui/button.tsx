import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function Button({
  className = '',
  variant = 'default',
  size = 'default',
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-medium whitespace-nowrap rounded-lg transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 select-none';

  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
    outline: 'border border-border bg-background hover:bg-muted hover:text-foreground text-foreground',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 text-foreground',
    ghost: 'hover:bg-muted hover:text-foreground text-foreground',
    destructive: 'bg-destructive text-white hover:bg-destructive/90',
    link: 'text-primary underline-offset-4 hover:underline bg-transparent',
  };

  const sizes = {
    default: 'h-8 px-3 py-1.5 text-xs gap-1.5',
    sm: 'h-7 px-2.5 text-[11px] gap-1 rounded-md',
    lg: 'h-9 px-4 text-sm gap-2',
    icon: 'size-8 flex items-center justify-center p-0',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
}
