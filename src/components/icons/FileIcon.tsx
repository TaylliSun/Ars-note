import React from 'react';
import { FolderIcon, FolderOpenIcon, MarkdownIcon, FileIcon as GenericFileIcon } from './ArsIcons';

interface FileIconProps {
  name: string;
  isDir: boolean;
  isOpen?: boolean;
  size?: number;
  className?: string;
}

const FileIconComponent: React.FC<FileIconProps> = ({ name, isDir, isOpen, size = 14, className }) => {
  if (isDir) {
    return isOpen ? <FolderOpenIcon size={size} className={className} /> : <FolderIcon size={size} className={className} />;
  }
  if (name.endsWith('.md')) {
    return <MarkdownIcon size={size} className={className} />;
  }
  return <GenericFileIcon size={size} className={className} />;
};

export default FileIconComponent;
