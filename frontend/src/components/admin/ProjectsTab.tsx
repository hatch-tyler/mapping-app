import { useEffect, useState } from 'react';
import { Project, ProjectDetail, User } from '../../api/types';
import * as projectsApi from '../../api/projects';
import { apiClient } from '../../api/client';

export function ProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const response = await projectsApi.getProjects();
      setProjects(response.projects);
    } catch {
      setError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleSelectProject = async (id: string) => {
    try {
      const detail = await projectsApi.getProject(id);
      setSelectedProject(detail);
    } catch {
      setError('Failed to load project details');
    }
  };

  const handleBack = () => {
    setSelectedProject(null);
    fetchProjects();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (selectedProject) {
    return (
      <ProjectDetailView
        project={selectedProject}
        onBack={handleBack}
        onUpdate={(updated) => setSelectedProject(updated)}
      />
    );
  }

  return (
    <div>
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Projects ({projects.length})
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
        >
          New Project
        </button>
      </div>

      {error && (
        <div className="p-4 text-red-600 bg-red-50 m-4 rounded-md text-sm">{error}</div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No projects yet</p>
          <p className="text-sm text-gray-400 mt-1">Create a project to organize datasets</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-200">
          {projects.map((project) => (
            <div
              key={project.id}
              className="px-6 py-4 hover:bg-gray-50 cursor-pointer flex items-center justify-between"
              onClick={() => handleSelectProject(project.id)}
            >
              <div>
                <div className="text-sm font-medium text-gray-900">{project.name}</div>
                {project.description && (
                  <div className="text-xs text-gray-500 mt-0.5">{project.description}</div>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>{project.member_count} member{project.member_count !== 1 ? 's' : ''}</span>
                <span>{project.dataset_count} dataset{project.dataset_count !== 1 ? 's' : ''}</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchProjects(); }}
        />
      )}
    </div>
  );
}


function CreateProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await projectsApi.createProject({ name: name.trim(), description: description.trim() || undefined });
      onCreated();
    } catch {
      setError('Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">New Project</h3>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label htmlFor="proj-name" className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              id="proj-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Project name"
              required
            />
          </div>
          <div>
            <label htmlFor="proj-desc" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional description"
            />
          </div>
          {error && <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">{error}</div>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">Cancel</button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className={`px-4 py-2 text-sm font-medium text-white rounded-md ${saving || !name.trim() ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


function ProjectDetailView({
  project,
  onBack,
  onUpdate,
}: {
  project: ProjectDetail;
  onBack: () => void;
  onUpdate: (project: ProjectDetail) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState('viewer');
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    // Load all users for the member dropdown
    apiClient.get<User[]>('/users/').then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  const reload = async () => {
    try {
      const updated = await projectsApi.getProject(project.id);
      onUpdate(updated);
    } catch {
      setError('Failed to refresh project');
    }
  };

  const handleAddMember = async () => {
    if (!addUserId) return;
    setError(null);
    try {
      await projectsApi.addMember(project.id, addUserId, addRole);
      setAddUserId('');
      setAddRole('viewer');
      await reload();
    } catch {
      setError('Failed to add member. User may already be a member.');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await projectsApi.removeMember(project.id, userId);
      await reload();
    } catch {
      setError('Failed to remove member');
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await projectsApi.updateMemberRole(project.id, userId, role);
      await reload();
    } catch {
      setError('Failed to update role');
    }
  };

  const handleDelete = async () => {
    try {
      await projectsApi.deleteProject(project.id);
      onBack();
    } catch {
      setError('Failed to delete project');
    }
  };

  // Users not already members
  const availableUsers = users.filter(
    (u) => !project.members.some((m) => m.user_id === u.id)
  );

  return (
    <div>
      <div className="px-6 py-4 border-b border-gray-200">
        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-800 mb-2">
          &larr; Back to Projects
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{project.name}</h2>
            {project.description && (
              <p className="text-sm text-gray-500 mt-0.5">{project.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{project.dataset_count} dataset{project.dataset_count !== 1 ? 's' : ''}</span>
            {deleteConfirm ? (
              <div className="flex gap-1">
                <button onClick={handleDelete} className="px-2 py-1 text-xs text-white bg-red-600 rounded hover:bg-red-700">Confirm Delete</button>
                <button onClick={() => setDeleteConfirm(false)} className="px-2 py-1 text-xs text-gray-600 bg-gray-200 rounded hover:bg-gray-300">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setDeleteConfirm(true)} className="p-1.5 rounded text-red-600 hover:bg-red-50" title="Delete project">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 text-red-600 bg-red-50 mx-6 mt-4 rounded-md text-sm">{error}</div>
      )}

      {/* Members */}
      <div className="px-6 py-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Members ({project.members.length})
        </h3>

        <div className="space-y-2 mb-4">
          {project.members.map((member) => (
            <div key={member.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-md">
              <div className="text-sm">
                <span className="font-medium text-gray-900">{member.user_name || member.user_email}</span>
                {member.user_name && member.user_email && (
                  <span className="text-gray-500 ml-2 text-xs">{member.user_email}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.user_id, e.target.value)}
                  className="text-xs border border-gray-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={() => handleRemoveMember(member.user_id)}
                  className="text-red-500 hover:text-red-700 p-1"
                  title="Remove member"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add member */}
        {availableUsers.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Add Member</label>
              <select
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select user...</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
                className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <button
              onClick={handleAddMember}
              disabled={!addUserId}
              className={`px-3 py-1.5 text-sm font-medium text-white rounded-md ${!addUserId ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
