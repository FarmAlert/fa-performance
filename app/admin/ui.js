"use client";

// Small admin building blocks (page header, panel, button) in the app's
// teal/green tokens. 44 px tap targets on touch screens.

export function PageHeader({ crumb, title, subtitle, actions }) {
  return (
    <div className="flex flex-col gap-3">
      {crumb && <div className="text-slate-400 text-xs font-semibold tracking-wide uppercase">{crumb}</div>}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-navy font-extrabold text-2xl sm:text-3xl tracking-tight">{title}</h1>
          {subtitle && <p className="text-slate-500 text-sm mt-1 max-w-2xl">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}

export function Panel({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={"bg-white rounded-2xl shadow-[0_1px_2px_rgba(13,59,79,0.06)] border border-slate-200/70 p-5 " + className}>
      {title && (
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-navy font-extrabold text-base">{title}</h2>
          {action}
        </div>
      )}
      {subtitle && <p className="text-slate-500 text-xs mt-1 mb-4">{subtitle}</p>}
      {title && !subtitle && <div className="mt-4" />}
      {children}
    </section>
  );
}

const VARIANTS = {
  primary: "bg-navy text-white hover:bg-navy/90 shadow-sm shadow-navy/20",
  secondary: "bg-white text-navy border border-slate-300 hover:border-navy/50 hover:bg-navy/5",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "bg-transparent text-navy hover:bg-navy/5",
};
const SIZES = { sm: "h-9 px-3.5 text-sm", md: "h-11 px-5 text-sm" };

export default function Button({ variant = "primary", size = "md", className = "", children, ...props }) {
  return (
    <button type="button" className={"inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed " + VARIANTS[variant] + " " + SIZES[size] + " " + className} {...props}>
      {children}
    </button>
  );
}
