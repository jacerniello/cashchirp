'use client';

import { DatabaseHealth } from './DatabaseHealth';
import { SetupAreaNav } from '../SetupAreaNav';

export default function DatabasePage() {
  return (
    <div className="bg-white min-h-[calc(100vh-4rem)] font-sans">
      <SetupAreaNav />
      <div className="py-12 px-8 pb-8 text-center border-b border-rule">
        <h1 className="font-sans text-[2rem] font-bold tracking-tight text-ink mb-2">Database</h1>
        <p className="text-base text-ink-light max-w-2xl mx-auto">
          Who is connected, what is blocking what, and the controls to clear a jam —
          the page for when the app is hanging and you need to know why.
        </p>
      </div>
      <DatabaseHealth />
    </div>
  );
}
