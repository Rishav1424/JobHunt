'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';
    socket = io(socketUrl, {
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
  }
  return socket;
}

export function useSocket(
  event: string,
  handler: (data: unknown) => void
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const s = getSocket();
    const cb = (data: unknown) => handlerRef.current(data);
    s.on(event, cb);
    return () => { s.off(event, cb); };
  }, [event]);
}

export function useJobSocket(jobId: string | null): {
  subscribeToJob: (id: string) => void;
  unsubscribeFromJob: (id: string) => void;
} {
  const subscribeToJob = useCallback((id: string) => {
    getSocket().emit('subscribe:job', id);
  }, []);

  const unsubscribeFromJob = useCallback((id: string) => {
    getSocket().emit('unsubscribe:job', id);
  }, []);

  useEffect(() => {
    if (jobId) {
      subscribeToJob(jobId);
      return () => unsubscribeFromJob(jobId);
    }
  }, [jobId, subscribeToJob, unsubscribeFromJob]);

  return { subscribeToJob, unsubscribeFromJob };
}
