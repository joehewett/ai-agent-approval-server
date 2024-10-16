import React, { useState, useEffect } from 'react';
import { ReviewRequest, ReviewResponse, ToolChoice } from './review';
import ReviewRequestDisplay from './components/review_request';
import HubStats from './components/hub_stats';
import { HubStats as HubStatsType } from './review';
import { UserIcon, BrainCircuitIcon, MessageSquareIcon, SlackIcon } from 'lucide-react';
import { fromTheme } from 'tailwind-merge';

// ApproverNames is a list of names of the approvers
const ApproverNames = [
  "HumanApprover",
  "LLMApprover",
  "ApproverByDebate",
  "SlackApprover",
];

const ApproverIcons = {
  HumanApprover: UserIcon,
  LLMApprover: BrainCircuitIcon,
  ApproverByDebate: MessageSquareIcon,
  SlackApprover: SlackIcon,
};

// The API base URL is set via an environment variable in the docker-compose.yml file
// @ts-ignore
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
// The websocket base URL is set via an environment variable in the docker-compose.yml file
// @ts-ignore
const WEBSOCKET_BASE_URL = import.meta.env.VITE_WEBSOCKET_BASE_URL;

const ApproverSelection: React.FC<{ onSelect: (approver: string) => void }> = ({ onSelect }) => {
  if (!API_BASE_URL || !WEBSOCKET_BASE_URL) {
    return <div>No API or WebSocket base URL set: API is: {API_BASE_URL} and WebSocket is: {WEBSOCKET_BASE_URL}</div>;
  }
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {ApproverNames.map((approver) => {
          const Icon = ApproverIcons[approver as keyof typeof ApproverIcons];
          return (
            <div
              key={approver}
              className="border p-4 rounded-lg cursor-pointer hover:bg-gray-100 flex flex-col items-center"
              onClick={() => onSelect(approver)}
            >
              <Icon size={24} className="mb-2" />
              <h2 className="text-xl text-center">{approver}</h2>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const NavBar: React.FC<{ onHome: () => void }> = ({ onHome }) => {
  return (
    <nav className="bg-gray-800 text-white p-4">
      <div className="container mx-auto flex justify-between items-center">
        <h1
          className="text-xl font-bold cursor-pointer hover:text-gray-300"
          onClick={onHome}
        >
          Approvals Interface
        </h1>
        <div className="text-sm">
          <p>API: {API_BASE_URL}</p>
          <p>WebSocket: {WEBSOCKET_BASE_URL}</p>
        </div>
      </div>
    </nav>
  );
};

const ApprovalsInterface: React.FC = () => {
  const [reviewDataList, setReviewDataList] = useState<ReviewRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [hubStats, setHubStats] = useState<HubStatsType | null>(null);
  const [selectedApprover, setSelectedApprover] = useState<string | null>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(WEBSOCKET_BASE_URL);
    setSocket(ws);

    ws.onmessage = (event) => {
      const data: ReviewRequest = JSON.parse(event.data);

      // Use functional update to ensure we have the latest state
      setReviewDataList((prevList) => {
        const newList = [...prevList, data];
        if (newList.length > 10) {
          newList.shift(); // Remove the oldest item
        }
        return newList;
      });

      // If no review is selected, automatically select the first one
      setSelectedRequestId((prevSelectedId) => prevSelectedId || data.request_id);
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed');
    };

    return () => {
      ws.close();
      // Wipe the review data list. The reviews will be reloaded from the server when the connection is re-established
      setReviewDataList([]);
    };
  }, []);

  // Start a timer to fetch the hub stats every second
  // TODO: this is a hack, but it works for now
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/stats`);
        const data: HubStatsType = await response.json();
        setHubStats(data);
      } catch (error) {
        console.error('Error fetching hub stats:', error);
      }
    };

    fetchStats();
    const statsInterval = setInterval(fetchStats, 1000);

    return () => {
      clearInterval(statsInterval);
    };
  }, []);

  // toolChoiceModified is a helper function to check if the tool choice has been modified
  const toolChoiceModified = (allToolChoices: ToolChoice[], toolChoice: ToolChoice) => {
    const originalToolChoice = allToolChoices.find(t => t.id === toolChoice.id);
    const modified = originalToolChoice && originalToolChoice.arguments !== toolChoice.arguments;
    return modified;
  };

  // Send a response to the Approvals API with the decision and the tool choice
  const sendResponse = (decision: string, requestId: string, toolChoice: ToolChoice) => {
    // Check if the tool args of the tool the user chose is not the same was it was originally
    if (selectedReviewRequest && toolChoiceModified(selectedReviewRequest.tool_choices, toolChoice)) {
      decision = "modify";
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      const response: ReviewResponse = {
        id: requestId,
        decision: decision,
        tool_choice: toolChoice
      };
      socket.send(JSON.stringify(response));

      // Remove the handled review request from the list
      setReviewDataList((prevList) => {
        const newList = prevList.filter((req) => req.request_id !== requestId);
        setSelectedRequestId((prevSelectedId) => {
          if (prevSelectedId === requestId) {
            return newList.length > 0 ? newList[0].request_id : null;
          } else {
            return prevSelectedId;
          }
        });
        return newList;
      });
    }
  };

  // When the user selects a review request, set the selected request ID
  const selectReviewRequest = (requestId: string) => {
    setSelectedRequestId(requestId);
  };

  // Find the selected review request
  const selectedReviewRequest = reviewDataList.find(
    (req) => req.request_id === selectedRequestId
  );

  // When the user clicks the title, go home
  const handleGoHome = () => {
    setSelectedApprover(null);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <NavBar onHome={handleGoHome} />

      <main className="flex-grow">
        {selectedApprover === null ? (
          <ApproverSelection onSelect={setSelectedApprover} />
        ) : selectedApprover !== "HumanApprover" ? (
          <div className="container mx-auto px-4 py-8">
            <h1 className="text-2xl font-bold mb-6">{selectedApprover}</h1>
            <p>This approver is not yet implemented.</p>
          </div>
        ) : (
          <>
            <div className="container mx-auto px-4 py-8 flex">
              {/* Sidebar */}
              <div className="w-full md:w-1/4 pr-4 border-r">
                <h2 className="text-xl font-semibold mb-4">Review Requests</h2>
                {reviewDataList.length === 0 ? (
                  <p>No review requests at the moment.</p>
                ) : (
                  <ul className="space-y-2">
                    {reviewDataList.map((req) => (
                      <li
                        key={req.request_id}
                        className={`cursor-pointer p-2 rounded-md ${req.request_id === selectedRequestId
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-800'
                          }`}
                        onClick={() => selectReviewRequest(req.request_id)}
                      >
                        <div className="font-semibold">Agent #{req.agent_id}</div>
                        <div className="text-sm">Request ID: {req.request_id.slice(0, 8)}</div>
                        {req.tool_choices && (
                          <div className="text-xs italic mt-1">Tool: {req.tool_choices[0].function}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Main Content */}
              <div className="w-full md:w-3/4 pl-4">
                {!selectedReviewRequest ? (
                  <div id="loading" className="text-left">
                    <p className="text-lg">Select a review request from the sidebar.</p>
                  </div>
                ) : (
                  <div id="content" className="space-y-6">
                    <ReviewRequestDisplay
                      reviewRequest={selectedReviewRequest}
                      sendResponse={(decision: string, toolChoice: ToolChoice) =>
                        sendResponse(decision, selectedReviewRequest.request_id, toolChoice)
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="container mx-auto px-4 py-8 flex flex-col">
              {/* Hub Stats */}
              <div className="mb-8">
                <h2 className="text-2xl font-semibold mb-4">Hub Statistics</h2>
                {hubStats ? (
                  <HubStats stats={hubStats} />
                ) : (
                  <p>Loading hub statistics...</p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default ApprovalsInterface;
