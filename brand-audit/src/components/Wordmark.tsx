export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-semibold tracking-tight ${
        small ? "text-[15px]" : "text-[17px]"
      }`}
      style={{ color: "var(--ink)" }}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-[6px]"
        style={{
          width: small ? 18 : 20,
          height: small ? 18 : 20,
          background: "var(--accent)",
        }}
      >
        <span
          className="block rounded-[2px]"
          style={{ width: small ? 6 : 7, height: small ? 6 : 7, background: "var(--surface)" }}
        />
      </span>
      Brand Audit
    </span>
  );
}
