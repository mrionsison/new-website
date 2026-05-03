// 1. Setup Supabase Client
// IMPORTANT: Replace these with your actual Supabase project URL and Anon Key
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';

const isConfigured = SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE';

if (!isConfigured) {
    document.getElementById('setup-warning').classList.remove('hidden');
    document.getElementById('loading-container').innerHTML = `<div class="empty-state">Waiting for Supabase configuration...</div>`;
}

// Initialize Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM Elements
const postsContainer = document.getElementById('posts-container');
const createPostForm = document.getElementById('create-post-form');
const postContentInput = document.getElementById('post-content');
const submitButton = document.getElementById('submit-post');
const toastContainer = document.getElementById('toast-container');

// State tracking for optimistic UI updates
const likedPosts = new Set(); 

// --- Utility Functions ---

// Time ago formatter
function timeAgo(dateString) {
    const date = new Date(dateString);
    const seconds = Math.floor((new Date() - date) / 1000);
    
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    if (seconds < 10) return "Just now";
    return Math.floor(seconds) + " seconds ago";
}

// XSS Prevention
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Toast Notification
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-circle-exclamation';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHTML(message)}</span>`;
    
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Core Logic ---

// Fetch Posts
async function fetchPosts() {
    if (!isConfigured) return;

    try {
        const { data: posts, error } = await supabase
            .from('posts')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error("Error fetching posts:", error);
            postsContainer.innerHTML = `<div class="empty-state" style="color: var(--danger-color);"><i class="fa-solid fa-triangle-exclamation"></i> Error loading posts. Check if table exists and permissions are correct.</div>`;
            return;
        }

        renderPosts(posts);
    } catch (err) {
        console.error("Unexpected error:", err);
        showToast("Failed to load feed", "error");
    }
}

// Render Posts
function renderPosts(posts) {
    postsContainer.innerHTML = '';

    if (!posts || posts.length === 0) {
        postsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-comment-dots fa-2x" style="color: #cbd5e1; margin-bottom: 10px;"></i>
                <p>No posts yet. Be the first to share something!</p>
            </div>`;
        return;
    }

    posts.forEach(post => {
        const safeContent = escapeHTML(post.content);
        // Default likes to 0 if column doesn't exist yet to prevent NaN
        const likesCount = post.likes || 0; 
        const isLiked = likedPosts.has(post.id);

        const postElement = document.createElement('article');
        postElement.className = 'card post';
        postElement.innerHTML = `
            <div class="post-header">
                <div class="avatar"><i class="fa-solid fa-user"></i></div>
                <div class="post-meta-info">
                    <span class="post-author">Anonymous User</span>
                    <span class="post-time">${timeAgo(post.created_at)}</span>
                </div>
            </div>
            <div class="post-content">${safeContent}</div>
            <div class="post-actions">
                <button class="action-btn like-btn ${isLiked ? 'liked' : ''}" data-id="${post.id}" data-likes="${likesCount}">
                    <i class="fa-${isLiked ? 'solid' : 'regular'} fa-heart"></i>
                    <span class="like-count">${likesCount}</span>
                </button>
            </div>
        `;
        postsContainer.appendChild(postElement);
    });

    // Attach like listeners
    document.querySelectorAll('.like-btn').forEach(btn => {
        btn.addEventListener('click', handleLike);
    });
}

// Handle Like Action
async function handleLike(e) {
    if (!isConfigured) {
        showToast("Please configure Supabase first", "error");
        return;
    }

    const btn = e.currentTarget;
    const postId = btn.getAttribute('data-id');
    const currentLikes = parseInt(btn.getAttribute('data-likes') || 0);
    const icon = btn.querySelector('i');
    const countSpan = btn.querySelector('.like-count');

    // Prevent double clicking while processing
    if (btn.disabled) return;
    btn.disabled = true;

    const isCurrentlyLiked = btn.classList.contains('liked');
    const newLikesCount = isCurrentlyLiked ? currentLikes - 1 : currentLikes + 1;

    // Optimistic UI Update
    btn.classList.toggle('liked');
    icon.classList.toggle('fa-solid');
    icon.classList.toggle('fa-regular');
    countSpan.textContent = newLikesCount;
    btn.setAttribute('data-likes', newLikesCount);

    if (isCurrentlyLiked) {
        likedPosts.delete(postId);
    } else {
        likedPosts.add(postId);
    }

    try {
        // Update database (Requires an RPC function for atomic increment ideally, 
        // but simple update works for prototype)
        const { error } = await supabase
            .from('posts')
            .update({ likes: newLikesCount })
            .eq('id', postId);

        if (error) throw error;
        
    } catch (err) {
        console.error("Error updating likes:", err);
        showToast("Could not save like", "error");
        
        // Revert UI on failure
        btn.classList.toggle('liked');
        icon.classList.toggle('fa-solid');
        icon.classList.toggle('fa-regular');
        countSpan.textContent = currentLikes;
        btn.setAttribute('data-likes', currentLikes);
        
        if (isCurrentlyLiked) likedPosts.add(postId);
        else likedPosts.delete(postId);
    } finally {
        btn.disabled = false;
    }
}

// Handle Post Submission
createPostForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!isConfigured) {
        showToast("Please configure Supabase first!", "error");
        return;
    }

    const content = postContentInput.value.trim();
    if (!content) return;

    submitButton.disabled = true;
    submitButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Posting...`;

    try {
        const { data, error } = await supabase
            .from('posts')
            .insert([{ content: content, likes: 0 }])
            .select();

        if (error) {
            console.error("Error inserting post:", error);
            showToast("Failed to publish post", "error");
        } else {
            postContentInput.value = '';
            showToast("Post published!");
            await fetchPosts();
        }
    } catch (err) {
        console.error("Unexpected error during insert:", err);
        showToast("An unexpected error occurred", "error");
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Post`;
    }
});

// Update timestamps periodically without fetching
setInterval(() => {
    const times = document.querySelectorAll('.post-time');
    // For a real app, you'd store the original timestamp in a data-attribute 
    // to recalculate accurately. Here we just re-render to keep it simple if needed.
    // fetchPosts(); // Too heavy. Better left static until refresh or implement logic.
}, 60000);

// Initial Load
fetchPosts();
