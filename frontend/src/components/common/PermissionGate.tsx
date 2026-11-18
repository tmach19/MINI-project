import React from 'react';
import { hasPermission } from '../../lib/permissions';
import type { UserProfile } from '../../types';

interface PermissionGateProps {
  user: UserProfile | null | undefined;
  require?: string | string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Component phân quyền declarative (tương đương *appHasPermission bên ICDS Angular).
 */
export const PermissionGate: React.FC<PermissionGateProps> = ({
  user,
  require: required,
  fallback = null,
  children,
}) => {
  if (!hasPermission(user, required)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
};
