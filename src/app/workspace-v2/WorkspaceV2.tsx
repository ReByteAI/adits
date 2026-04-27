import ChatPanel from './ChatPanel'
import Bench from './Bench'
import ProjectGate from '../components/ProjectGate'
import { useActiveProjectId } from '../store.ts'

export default function WorkspaceV2() {
  const id = useActiveProjectId()
  return (
    <div className="wsv2">
      <ChatPanel />
      <div className="wsv2-bench-gate">
        {id ? (
          <ProjectGate key={id} projectId={id}>
            <Bench />
          </ProjectGate>
        ) : (
          <Bench />
        )}
      </div>
    </div>
  )
}
